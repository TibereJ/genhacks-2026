# BlindSpot server (API + report UI + demo clinic) in a container. See docs/DEPLOY.md.
# The Playwright image ships Chromium and its system libraries; its version must match
# the `playwright` npm package (node_modules/playwright/package.json).
FROM mcr.microsoft.com/playwright:v1.63.0-noble

WORKDIR /app

# Dependencies first, for layer caching. tsx is a dev dependency and runs the server, so no --omit=dev.
COPY package.json package-lock.json ./
RUN npm ci && npm cache clean --force

COPY . .
# Reports are written at runtime: the only directory the app user needs to write to.
RUN mkdir -p /app/reports && chown -R pwuser:pwuser /app/reports

ENV PORT=3000
EXPOSE 3000

# Non-root user provided by the Playwright image.
USER pwuser

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/reports').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

CMD ["npx", "tsx", "src/server.ts"]
