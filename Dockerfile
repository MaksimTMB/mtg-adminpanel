# Stage 1: Build frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /build

# Copy frontend source
COPY frontend/package.json frontend/package-lock.json* ./frontend/
RUN cd frontend && npm install

COPY frontend/ ./frontend/

# vite builds to ../backend/public (relative to frontend dir = /build/backend/public)
RUN cd frontend && npm run build

# Stage 2: Production backend
FROM node:20-alpine

WORKDIR /app

COPY backend/package.json ./
RUN npm install --production

COPY backend/src ./src

# Copy built frontend (vite outputted to /build/backend/public)
COPY --from=frontend-builder /build/backend/public ./public

EXPOSE 3000

CMD ["node", "src/app.js"]
