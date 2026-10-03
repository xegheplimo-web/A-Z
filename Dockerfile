# ---- deps ----
FROM node:26-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm install

# ---- builder ----
FROM node:26-alpine AS builder
WORKDIR /app
ARG DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app_db
ENV DATABASE_URL=$DATABASE_URL
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- runner ----
FROM node:26-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts
# app-migrate in docker-compose.production.yml uses the exact schema bundled
# with this image before the facade starts.
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/src/db ./src/db
COPY --from=builder /app/public ./public

EXPOSE 3000
CMD ["npm", "start"]
