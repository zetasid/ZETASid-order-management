FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
ENV COREPACK_HOME=/opt/corepack
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile

FROM dependencies AS migrate
ENV NODE_ENV=production
CMD ["pnpm", "--filter", "@workspace/db", "run", "migrate"]

FROM dependencies AS build
RUN PORT=3000 BASE_PATH=/ NODE_ENV=production pnpm --filter @workspace/zetas-id run build \
    && pnpm --filter @workspace/api-server run build

FROM node:24-bookworm-slim AS api
WORKDIR /app
ENV NODE_ENV=production PORT=5000
COPY --from=build --chown=node:node /app/artifacts/api-server/dist ./dist
USER node
EXPOSE 5000
CMD ["node", "--enable-source-maps", "dist/index.mjs"]

FROM nginx:1.28-alpine AS web
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/artifacts/zetas-id/dist/public /usr/share/nginx/html
EXPOSE 80