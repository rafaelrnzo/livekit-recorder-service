import { startRecording, stopRecording } from "./recorder";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
};

const port = process.env.PORT || 4000;

const server = Bun.serve({
    port,
    async fetch(req) {
        if (req.method === "OPTIONS") {
            return new Response(null, { status: 204, headers: corsHeaders });
        }

        if (req.method === "POST" && new URL(req.url).pathname === "/start") {
            const body = await req.json() as { roomId?: string, roomCode?: string };

            if (!body.roomId || !body.roomCode) {
                return new Response(JSON.stringify({ error: "Missing room ID or room code" }), {
                    status: 400,
                    headers: { "Content-Type": "application/json", ...corsHeaders }
                });
            }

            const baseUrl = process.env.FRONTEND_URL || "http://localhost:3000";
            const roomUrl = `${baseUrl}/meeting/${body.roomCode}?identity=RecorderBot&bot=true`;
            const outputName = `${body.roomId}-${Date.now()}.mp4`;

            startRecording(body.roomId, roomUrl, outputName);

            return new Response(JSON.stringify({ message: "Recording started" }), {
                status: 200,
                headers: { "Content-Type": "application/json", ...corsHeaders }
            });
        }

        if (req.method === "POST" && new URL(req.url).pathname === "/stop") {
            const body = await req.json() as { roomId?: string };

            if (!body.roomId) {
                return new Response(JSON.stringify({ error: "Missing room ID" }), {
                    status: 400,
                    headers: { "Content-Type": "application/json", ...corsHeaders }
                });
            }

            try {
                const outputName = await stopRecording(body.roomId);
                return new Response(JSON.stringify({ message: "Recording stopped", outputName }), {
                    status: 200,
                    headers: { "Content-Type": "application/json", ...corsHeaders }
                });
            } catch (err: any) {
                return new Response(JSON.stringify({ error: err.message }), {
                    status: 500,
                    headers: { "Content-Type": "application/json", ...corsHeaders }
                });
            }
        }

        if (req.method === "GET" && new URL(req.url).pathname.startsWith("/progress/")) {
            const egressId = new URL(req.url).pathname.split("/").pop();
            if (!egressId) {
                return new Response(JSON.stringify({ error: "Missing egress ID" }), {
                    status: 400,
                    headers: { "Content-Type": "application/json", ...corsHeaders }
                });
            }

            // Using dynamic import or direct import if we exported the progress map
            // Since bun allows caching we can just import the map
            const { extractionProgress } = await import("./recorder");

            const state = extractionProgress.get(egressId);
            if (!state) {
                return new Response(JSON.stringify({ status: "UNKNOWN", progress: 0 }), {
                    status: 200,
                    headers: { "Content-Type": "application/json", ...corsHeaders }
                });
            }

            return new Response(JSON.stringify(state), {
                status: 200,
                headers: { "Content-Type": "application/json", ...corsHeaders }
            });
        }

        return new Response("Not found", { status: 404, headers: corsHeaders });
    }
});

console.log(`
===================================================
        Recorder Service Started Successfully
===================================================
Running on port : ${server.port}
Local URL       : http://localhost:${server.port}
Started at      : ${new Date().toLocaleString()}
===================================================
`);