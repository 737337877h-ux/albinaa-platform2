# ============================================================================
# Albinaa Platform — Backend (Milestone 2)
# Multi-stage build: small runtime image without build tools
# ============================================================================
FROM node:22-alpine AS deps
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app/backend
COPY --from=deps /app/backend/node_modules ./node_modules
COPY backend/ ./
COPY prisma/ ../prisma/
RUN npx prisma generate --schema=../prisma/schema.prisma && npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Python للـ Parser المُختبر (قرار موثق: لا إعادة كتابة لمنطق التحليل)
RUN apk add --no-cache python3 py3-openpyxl
# مستخدم غير جذري
RUN addgroup -S app && adduser -S app -G app
COPY --from=deps /app/backend/node_modules ./node_modules
COPY --from=build /app/backend/dist ./dist
COPY --from=build /app/backend/node_modules/.prisma ./node_modules/.prisma
COPY prisma/ ./prisma/
COPY backend/parser/ ./parser/
COPY backend/docker-entrypoint.sh ./
RUN mkdir -p /data/uploads && chown -R app:app /data
RUN chmod +x docker-entrypoint.sh && chown -R app:app /app
ENV PARSER_DIR=/app/parser UPLOAD_DIR=/data/uploads
USER app
EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
