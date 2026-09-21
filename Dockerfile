FROM node:22-alpine

WORKDIR /app

# The app intentionally has no runtime npm dependencies. Keeping the image
# dependency-free makes it small and avoids native modules for large PKG hosts.
COPY package.json ./

COPY server.js ./server.js
COPY public ./public

ENV NODE_ENV=production \
    LOG_LEVEL=info \
    PORT=8080 \
    HOST=0.0.0.0 \
    PKG_DIR=/pkg \
    DATA_DIR=/data

RUN mkdir -p /pkg /data && chown -R node:node /app /pkg /data
USER node

VOLUME ["/pkg", "/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]
