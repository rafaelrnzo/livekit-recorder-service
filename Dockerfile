FROM oven/bun:1-debian

WORKDIR /app

# Install Chromium, FFmpeg, and fonts needed for Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    ffmpeg \
    fonts-liberation \
    fonts-noto-color-emoji \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Skip downloading Chrome for Puppeteer and use the installed Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Copy package files
COPY package.json bun.lock ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy the rest of the application
COPY . .

# Expose the API port
EXPOSE 4000

# Command to run the service
CMD ["bun", "run", "src/server.ts"]
