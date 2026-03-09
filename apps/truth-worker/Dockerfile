FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/observability/package.json packages/observability/
COPY apps/truth-worker/package.json apps/truth-worker/
RUN npm ci --workspace=@hybrid-memory/shared-types --workspace=@hybrid-memory/observability --workspace=@hybrid-memory/truth-worker
COPY packages/shared-types/ packages/shared-types/
COPY packages/observability/ packages/observability/
COPY apps/truth-worker/ apps/truth-worker/
RUN npm run build --workspace=@hybrid-memory/shared-types
RUN npm run build --workspace=@hybrid-memory/truth-worker

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=builder /app/packages/shared-types/package.json ./packages/shared-types/
COPY --from=builder /app/packages/observability/dist ./packages/observability/dist
COPY --from=builder /app/packages/observability/package.json ./packages/observability/
COPY --from=builder /app/apps/truth-worker/dist ./apps/truth-worker/dist
COPY --from=builder /app/apps/truth-worker/package.json ./apps/truth-worker/
CMD ["node", "apps/truth-worker/dist/main.js"]
