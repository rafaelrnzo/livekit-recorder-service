import { startRecording, stopRecording } from "./recorder";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
};

Bun.serve({
    port: 4000,
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
                await stopRecording(body.roomId);
                return new Response(JSON.stringify({ message: "Recording stopped" }), {
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

        return new Response("Not found", { status: 404, headers: corsHeaders });
    }
});