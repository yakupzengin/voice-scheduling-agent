# ---------------------------------------------------------------------------
# Build stage — compiles TypeScript
# ---------------------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# ---------------------------------------------------------------------------
# Production stage — minimal image with compiled output only
# ---------------------------------------------------------------------------
FROM node:20-alpine AS runner

WORKDIR /app

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled output from build stage
COPY --from=builder /app/dist ./dist

# Create the /data directory for the Railway-mounted SQLite volume.
RUN mkdir -p /data

EXPOSE 3000

CMD ["node", "dist/index.js"]
