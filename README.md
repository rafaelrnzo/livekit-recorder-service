# Recorder Service

This is the Recorder Service responsible for recording video conference meetings by running a hidden headless browser that captures the screen and audio via `puppeteer` and `ffmpeg`, and then streaming the output.

## Prerequisites
- [Bun](https://bun.sh/)
- `ffmpeg` installed on the host machine (if running directly without Docker).
- `chromium` installed (if running directly without Docker).
- MinIO instance (for uploading recorded videos).

## Environment Variables
Create a `.env` file in the root of the service based on `.env.example` or the required fields:

```env
FRONTEND_URL=http://localhost:3000
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium # If using Docker
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET_NAME=recordings
```

## Running Locally

Install dependencies:
```bash
bun install
```

Start the service:
```bash
bun run src/server.ts
```

## Running with Docker

Build the image:
```bash
docker build -t recorder-service:latest .
```

Run the container:
```bash
docker run -d \
  -p 4000:4000 \
  --name recorder-service-app \
  --env-file .env \
  recorder-service:latest
```

## API Endpoints

### `POST /start`
Starts a recording for a specific room.
**Body:**
```json
{
  "roomId": "unique-room-id",
  "roomCode": "meeting-code"
}
```

### `POST /stop`
Stops the active recording for a room.
**Body:**
```json
{
  "roomId": "unique-room-id"
}
```
