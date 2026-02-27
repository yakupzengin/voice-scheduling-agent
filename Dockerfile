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

# Non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Create the /data directory and give the non-root user write access.
# Railway mounts the persistent volume here — the process must own the path.
RUN mkdir -p /data && chown appuser:appgroup /data

USER appuser

EXPOSE 3000

CMD ["node", "dist/index.js"]
