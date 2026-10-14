# One image for both services. render.yaml picks which one runs via `dockerCommand`.
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app

# dependencies first (cached layer); devDependencies (jsdom) are not installed
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY shared ./shared
COPY public ./public
COPY adj ./adj

# Render sets PORT (10000). Default start = public site; the adjudicator service overrides it.
# Runs as root on purpose: Render mounts the persistent disk (/var/data) root-owned.
EXPOSE 10000
CMD ["node", "public/server.js"]
