# ---- Stage 1: Build ----
FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ---- Stage 2: Production ----
FROM node:22-alpine
WORKDIR /app

# Add healthcheck deps
RUN apk add --no-cache wget

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/lib ./lib

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["node", "./lib/src/bot-main.js"]
