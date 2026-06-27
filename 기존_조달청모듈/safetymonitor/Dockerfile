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

# AI CCTV 서버 주소 — NEXT_PUBLIC_* 는 빌드타임에 번들에 인라인된다. .env.* 는 .dockerignore 로 제외되므로
# 클라우드 AI 서버 URL 은 빌드 시 --build-arg NEXT_PUBLIC_AI_CCTV_API=https://... 로 주입.
# 미주입(빈값) 시 코드가 http://localhost:8000 로 폴백(현행 동작 유지).
ARG NEXT_PUBLIC_AI_CCTV_API=""
ENV NEXT_PUBLIC_AI_CCTV_API=$NEXT_PUBLIC_AI_CCTV_API

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
