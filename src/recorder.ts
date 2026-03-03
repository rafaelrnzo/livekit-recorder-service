import puppeteer, { Browser } from "puppeteer";
import { spawn } from "child_process";
import ffmpegStatic from "ffmpeg-static";
import { uploadStream } from "./storage";
import fs from "fs";
import path from "path";

export const activeSessions = new Map<string, { browser: Browser, wsServer: any, outputName: string, webmPath: string, fileStream: fs.WriteStream }>();
export const extractionProgress = new Map<string, { status: string, progress: number }>();

export async function startRecording(roomId: string, roomUrl: string, outputName: string) {
    const browser = await puppeteer.launch({
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--use-fake-ui-for-media-stream",
            "--auto-select-desktop-capture-source=Entire screen",
            "--window-size=1280,720"
        ],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });

    // Navigate to the room URL
    await page.goto(roomUrl, { waitUntil: "networkidle2" });

    // We give the meeting room 5 seconds to load participants properly
    await new Promise(r => setTimeout(r, 5000));

    // Determine temporary path for webm stream
    const tempDir = process.env.TEMP_DIR || "/tmp";
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }
    const webmPath = path.join(tempDir, `${outputName}.webm`);
    const fileStream = fs.createWriteStream(webmPath);

    // Initial progress setup
    extractionProgress.set(outputName, { status: "RECORDING", progress: 0 });

    // Start a local WebSocket Server on a random port to receive video chunks
    const wsServer = Bun.serve({
        port: 0, // random available port
        fetch(req, server) {
            if (server.upgrade(req)) return;
            return new Response("Upgrade failed", { status: 500 });
        },
        websocket: {
            message(ws, message) {
                if (Buffer.isBuffer(message)) {
                    fileStream.write(message);
                }
            },
            close(ws) {
                fileStream.end();
            }
        }
    });

    const wsPort = wsServer.port;

    // Capture stream from browser tab and send to websocket
    await page.evaluate(async (port) => {
        try {
            const stream = await (navigator as any).mediaDevices.getDisplayMedia({
                video: {
                    displaySurface: "browser",
                } as any,
                audio: true,
                preferCurrentTab: true
            } as any);

            const MR: any = (globalThis as any).MediaRecorder;
            const mediaRecorder = new MR(stream, { mimeType: 'video/webm; codecs=vp8' });

            const ws = new WebSocket(`ws://localhost:${port}`);
            ws.onopen = () => {
                mediaRecorder.ondataavailable = async (e: any) => {
                    if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
                        ws.send(await e.data.arrayBuffer());
                    }
                };
                mediaRecorder.start(100); // Send chunks every 100ms
            };

            ws.onerror = (err: any) => console.error("WebSocket error:", err);

            // allow external stopping if needed
            (globalThis as any).stopRecording = () => {
                mediaRecorder.stop();
                ws.close();
                stream.getTracks().forEach((track: any) => track.stop());
            };
        } catch (err: any) {
            console.error("Failed to capture stream via getDisplayMedia", err.message);
        }
    }, wsPort);

    activeSessions.set(roomId, { browser, wsServer, outputName, webmPath, fileStream });
}

export async function stopRecording(roomId: string): Promise<string> {
    const session = activeSessions.get(roomId);
    if (!session) {
        throw new Error(`No active recording found for room ${roomId}`);
    }

    try {
        console.log(`[Recorder] Stopping session ${roomId}`);

        // Terminate page and browser first to immediately stop media capture without hanging evaluate calls
        const pages = await session.browser.pages().catch(() => []);
        if (pages && pages.length > 0 && pages[0]) {
            await pages[0].close().catch(() => { });
        }

        const proc = session.browser.process();
        if (proc) {
            proc.kill('SIGKILL');
        } else {
            await session.browser.close().catch(() => { });
        }

        // Safely end WebSockets and file streams
        try {
            session.wsServer.stop();
        } catch (e) { }

        try {
            session.fileStream.end();
        } catch (e) { }

        activeSessions.delete(roomId);
        console.log(`[Recorder] Session ${roomId} capture stopped successfully. Triggering background extraction.`);

        // Start background FFmpeg task
        extractionProgress.set(session.outputName, { status: "PROCESSING", progress: 0 });
        processBackgroundVideo(session.webmPath, session.outputName);

        return session.outputName;
    } catch (e) {
        console.error(`Failed to completely stop recording for ${roomId}`, e);
        throw e;
    }
}

async function processBackgroundVideo(webmPath: string, outputName: string) {
    const ffmpegPath = ffmpegStatic || "ffmpeg";

    // First get duration for progress calculation
    const ffprobe = spawn(ffmpegPath, [
        "-i", webmPath,
    ]);

    let durationInSecs = 0;
    ffprobe.stderr.on("data", (data) => {
        const str = data.toString();
        // Look for Duration: 00:00:00.00
        const match = str.match(/Duration: (\d{2}):(\d{2}):(\d{2}\.\d{2})/);
        if (match) {
            const hours = parseFloat(match[1]);
            const minutes = parseFloat(match[2]);
            const seconds = parseFloat(match[3]);
            durationInSecs = hours * 3600 + minutes * 60 + seconds;
        }
    });

    await new Promise(r => ffprobe.on("close", r));

    console.log(`[FFMPEG] Starting extraction for ${outputName}. Duration calculated: ${durationInSecs}s`);

    const ffmpeg = spawn(ffmpegPath, [
        "-f", "webm",
        "-i", webmPath,
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-movflags", "frag_keyframe+empty_moov",
        "-f", "mp4",
        "pipe:1",
    ]);

    // Upload ffmpeg stdout directly to MinIO
    uploadStream(outputName, ffmpeg.stdout).then(() => {
        console.log(`[FFMPEG] Finished uploading ${outputName} to MinIO.`);
        extractionProgress.set(outputName, { status: "COMPLETED", progress: 100 });
        // Clean up temp file
        fs.unlink(webmPath, () => { });
    }).catch(err => {
        console.error(`[FFMPEG] Failed to upload ${outputName} to MinIO`, err);
        extractionProgress.set(outputName, { status: "ERROR", progress: 0 });
    });

    ffmpeg.stderr.on("data", (data) => {
        const str = data.toString();
        // Look for time=00:00:00.00
        const match = str.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
        if (match && durationInSecs > 0) {
            const hours = parseFloat(match[1]);
            const minutes = parseFloat(match[2]);
            const seconds = parseFloat(match[3]);
            const currentTime = hours * 3600 + minutes * 60 + seconds;
            const percentage = Math.floor((currentTime / durationInSecs) * 100);

            // Just incase it goes weird, cap it at 99. The upload promise closing will set to 100.
            const safeProgress = Math.min(percentage, 99);
            extractionProgress.set(outputName, { status: "PROCESSING", progress: safeProgress });
        }
    });
}