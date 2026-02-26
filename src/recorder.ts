import puppeteer, { Browser } from "puppeteer";
import { spawn } from "child_process";
import ffmpegStatic from "ffmpeg-static";
import { uploadStream } from "./storage";

export const activeSessions = new Map<string, { browser: Browser, wsServer: any, ffmpeg: any }>();

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

    const ffmpegPath = ffmpegStatic || "ffmpeg";

    const ffmpeg = spawn(ffmpegPath, [
        "-f", "webm",
        "-i", "pipe:0",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-movflags", "frag_keyframe+empty_moov",
        "-f", "mp4",
        "pipe:1",
    ]);

    // upload ffmpeg stdout to MinIO
    uploadStream(outputName, ffmpeg.stdout);

    ffmpeg.stderr.on("data", (d) => console.log(d.toString()));

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
                    ffmpeg.stdin.write(message);
                }
            },
            close(ws) {
                ffmpeg.stdin.end();
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

    activeSessions.set(roomId, { browser, wsServer, ffmpeg });

    // You might want to handle when recording stops (e.g. from the page or a timer)
    // For now, it records until the server dies, the browser page is closed, or stopRecording is called.
}

export async function stopRecording(roomId: string) {
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

        // Safely end WebSockets and FFmpeg stdin
        try {
            session.wsServer.stop();
        } catch (e) { }

        try {
            session.ffmpeg.stdin.end();
        } catch (e) { }

        activeSessions.delete(roomId);
        console.log(`[Recorder] Session ${roomId} stopped successfully.`);
    } catch (e) {
        console.error(`Failed to completely stop recording for ${roomId}`, e);
        throw e;
    }
}