#!/bin/bash
# 관제 대시보드(Next.js dev :3000) 원클릭 — 더블클릭하면 별도 터미널에서 실행돼 안 죽음(데모 안정).
# 이 창을 닫으면 대시보드가 꺼집니다. 발표 중엔 열어두세요.
cd "$(dirname "$0")" || { echo "폴더 이동 실패"; read -r -p "엔터로 종료..."; exit 1; }
echo "▶ 작업 폴더: $(pwd)"
echo "▶ 기존 :3000 정리 후 대시보드 dev 기동... (이 창 닫으면 대시보드 꺼짐, Ctrl+C 로 중지)"
lsof -ti tcp:3000 2>/dev/null | xargs kill 2>/dev/null
sleep 1
pnpm dev:web
