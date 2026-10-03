FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
ENV COREPACK_HOME=/opt/corepack
RUN corepack enable
# Only product source enters the build context; no workspace tools or secrets.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY tsconfig*.json ./
COPY lib ./lib
COPY artifacts/api-server ./artifacts/api-server
COPY artifacts/zetas-id ./artifacts/zetas-id
RUN pnpm install --frozen-lockfile

FROM dependencies AS build
RUN PORT=3000 BASE_PATH=/ NODE_ENV=production pnpm --filter @workspace/zetas-id run build \
    && pnpm --filter @workspace/api-server run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=5000
USER node

FROM runtime AS migrate
COPY --from=build --chown=node:node /app/artifacts/api-server/dist/migrate.mjs ./dist/migrate.mjs
COPY --from=build --chown=node:node /app/lib/db/migrations ./migrations
CMD ["node", "dist/migrate.mjs"]

FROM runtime AS api
COPY --from=build --chown=node:node /app/artifacts/api-server/dist ./dist
EXPOSE 5000
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=5 \
    CMD node -e "fetch('http://127.0.0.1:5000/api/healthz',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "dist/index.mjs"]

FROM nginx:1.28-alpine AS web
COPY deploy/nginx-main.conf /etc/nginx/nginx.conf
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/artifacts/zetas-id/dist/public /usr/share/nginx/html
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=5 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]