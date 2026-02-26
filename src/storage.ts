import { Client } from "minio";

const minioClient = new Client({
    endPoint: process.env.MINIO_ENDPOINT || "127.0.0.1",
    port: parseInt(process.env.MINIO_PORT || "9000"),
    useSSL: process.env.MINIO_USE_SSL === "true",
    accessKey: process.env.MINIO_ACCESS_KEY || "admin",
    secretKey: process.env.MINIO_SECRET_KEY || "admin.admin",
});

export async function uploadStream(
    objectName: string,
    stream: NodeJS.ReadableStream | any
) {
    const bucketName = process.env.MINIO_BUCKET || "livekit";

    return minioClient.putObject(
        bucketName,
        objectName,
        stream as any,
        undefined,
        { "Content-Type": "video/mp4" }
    );
}