# VitAlGuard 관제 웹(Next.js) Cloud Run 컨테이너 — pnpm 모노레포 standalone 빌드.
# syntax=docker/dockerfile:1

##### Builder — 모노레포 의존성 설치 + 패키지/대시보드 빌드 #####
FROM node:22-slim AS builder
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

# 전체 컨텍스트 복사(.dockerignore 로 node_modules/.next/.env/Flutter 등 제외).
COPY . .

# 워크스페이스 전체 frozen 설치(로컬에서 검증된 방식). sharp/esbuild 는 linux 바이너리 자동 설치.
RUN pnpm install --frozen-lockfile

# dashboard 가 import 하는 워크스페이스 패키지 먼저 빌드 → 대시보드 standalone 빌드.
RUN pnpm --filter "@safetymonitor/schemas" --filter "@safetymonitor/analyzers" build \
 && pnpm --filter "@safetymonitor/dashboard-web" build

##### Runner — standalone 최소 런타임(슬림) #####
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=8080

# Next standalone 산출물(server.js + 추적된 node_modules) + static + public.
# monorepo 라 server.js 는 apps/dashboard-web/ 하위 경로 유지.
COPY --from=builder --chown=node:node /repo/apps/dashboard-web/.next/standalone ./
COPY --from=builder --chown=node:node /repo/apps/dashboard-web/.next/static ./apps/dashboard-web/.next/static
COPY --from=builder --chown=node:node /repo/apps/dashboard-web/public ./apps/dashboard-web/public

USER node
EXPOSE 8080
CMD ["node", "apps/dashboard-web/server.js"]
