# API server + built web client. The AI model runs in the separate "ollama" service (see docker-compose.yml).
FROM node:24-slim

WORKDIR /app

# Install dependencies first so source changes don't invalidate this layer.
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci

COPY tsconfig.base.json ./
COPY shared shared
COPY server server
COPY client client
RUN npm run build

ENV NODE_ENV=production \
    PORT=4000 \
    STORAGE_DIR=/app/server/storage
EXPOSE 4000
VOLUME ["/app/server/storage"]

WORKDIR /app/server
CMD ["npm", "start"]
