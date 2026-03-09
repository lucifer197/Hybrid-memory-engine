FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/observability/package.json packages/observability/
COPY apps/memory-service/package.json apps/memory-service/
RUN npm ci --workspace=@hybrid-memory/shared-types --workspace=@hybrid-memory/observability --workspace=@hybrid-memory/memory-service
COPY packages/shared-types/ packages/shared-types/
COPY packages/observability/ packages/observability/
COPY apps/memory-service/ apps/memory-service/
RUN npm run build --workspace=@hybrid-memory/shared-types
RUN npm run build --workspace=@hybrid-memory/memory-service

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=builder /app/packages/shared-types/package.json ./packages/shared-types/
COPY --from=builder /app/packages/observability/dist ./packages/observability/dist
COPY --from=builder /app/packages/observability/package.json ./packages/observability/
COPY --from=builder /app/apps/memory-service/dist ./apps/memory-service/dist
COPY --from=builder /app/apps/memory-service/package.json ./apps/memory-service/
COPY --from=builder /app/apps/memory-service/src/migrations ./apps/memory-service/src/migrations
EXPOSE 3001
CMD ["node", "apps/memory-service/dist/http/server.js"]
