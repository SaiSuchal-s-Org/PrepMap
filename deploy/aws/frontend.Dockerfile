FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
ENV CI=true

COPY . .
RUN pnpm install --frozen-lockfile

RUN pnpm --dir artifacts/exam-roadmap run build

FROM nginx:1.27-alpine AS runner
WORKDIR /usr/share/nginx/html

COPY deploy/aws/frontend.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/artifacts/exam-roadmap/dist/public ./

EXPOSE 80
