# ══════════════════════════════════════════════
#  Stage 1: Build frontend
# ══════════════════════════════════════════════
FROM node:18-alpine AS builder

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# ══════════════════════════════════════════════
#  Stage 2: Production server
# ══════════════════════════════════════════════
FROM node:18-alpine

WORKDIR /app

COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev

COPY backend/ ./backend/
COPY --from=builder /app/frontend/dist ./frontend/dist

EXPOSE 8000

CMD ["node", "backend/server.js"]