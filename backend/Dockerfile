# ============================================================================
# منصة البناء الراقي — Backend (Milestone 2)
# بناء متعدد المراحل: صورة نهائية صغيرة بدون أدوات بناء
# ============================================================================
FROM node:22-alpine AS deps
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY backend/ ./
COPY prisma/ ./prisma/
RUN npx prisma generate --schema=./prisma/schema.prisma && npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Python للـ Parser المُختبر (قرار موثق: لا إعادة كتابة لمنطق التحليل)
RUN apk add --no-cache python3 py3-openpyxl
# مستخدم غير جذري
RUN addgroup -S app && adduser -S app -G app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY prisma/ ./prisma/
COPY backend/parser/ ./parser/
COPY backend/docker-entrypoint.sh ./
RUN mkdir -p /data/uploads && chown -R app:app /data
RUN chmod +x docker-entrypoint.sh && chown -R app:app /app
ENV PARSER_DIR=/app/parser UPLOAD_DIR=/data/uploads
USER app
EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
