// 관리자 — 현장정보 + vital_samples 를 기간/워커 필터로 CSV 스트리밍 다운로드.
// 전체 로드 금지: 키셋 페이지네이션(iterateExportRows)으로 배치 단위 조회 → ReadableStream pull 로
// 백프레셔를 받으며 직송. 메모리 상주 = 1배치(기본 5,000행) — 데이터가 얼마나 쌓여도 성립.
// (과거: 전체 기간 313k 행 SELECT * 일괄 로드 → Node 힙 OOM → 컨테이너 사망 503 + 라이브 수집 순단)
import { NextResponse } from "next/server";

import { hasAdminMenuAccess } from "../../../../lib/admin-auth";
import {
  countExportRows,
  exportSiteInfoLogs,
  getWorkerProfiles,
  iterateExportRows,
} from "../../../../lib/db";
import {
  csvFilenameFor,
  csvPrologue,
  rowsToCsvChunk,
} from "../../../../lib/export-csv";
import {
  releaseExportSlot,
  tryAcquireExportSlot,
} from "../../../../lib/export-guard";

export async function GET(request: Request) {
  if (!(await hasAdminMenuAccess(request))) {
    return NextResponse.json(
      { ok: false, error: "관리자 인증 필요" },
      { status: 401 },
    );
  }

  const url = new URL(request.url);
  const workerId = url.searchParams.get("workerId") || undefined;
  const fromRaw = url.searchParams.get("from");
  const toRaw = url.searchParams.get("to");

  // 기본 기간 — 최근 30일 (산업재해 자료 일반 제출 단위)
  const now = new Date();
  const defaultTo = now.toISOString();
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const from = fromRaw || defaultFrom;
  const to = toRaw || defaultTo;

  if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
    return NextResponse.json(
      { ok: false, error: "from / to 는 ISO 8601 형식이어야 합니다." },
      { status: 400 },
    );
  }

  // 동시 내보내기 1건 제한 — 대용량 스트리밍 중첩으로 인한 메모리 중첩 방지(CSV·XLSX 공유 가드)
  if (!tryAcquireExportSlot()) {
    return NextResponse.json(
      { ok: false, error: "다른 내보내기가 진행 중입니다. 완료 후 다시 시도하세요." },
      { status: 429 },
    );
  }
  // 스트림 종료/중단/오류 어느 경로로든 정확히 1회만 해제
  let released = false;
  const release = () => {
    if (!released) {
      released = true;
      releaseExportSlot();
    }
  };

  try {
    const [siteInfoRows, profiles, totalRows] = await Promise.all([
      exportSiteInfoLogs({ from, to }),
      getWorkerProfiles(),
      countExportRows({ workerId, from, to }),
    ]);

    const gen = iterateExportRows({ workerId, from, to });
    const encoder = new TextEncoder();
    const startedAt = Date.now();
    let prologueSent = false;
    let sentRows = 0;

    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          if (!prologueSent) {
            prologueSent = true;
            // 한국어 엑셀 호환 UTF-8 BOM + 현장정보 블록 + 생체데이터 헤더
            controller.enqueue(encoder.encode("﻿" + csvPrologue(siteInfoRows)));
            return;
          }
          const { value, done } = await gen.next();
          if (done) {
            // eslint-disable-next-line no-console -- 내보내기 관측 로그(시작/완료/행수/소요) 의도적 유지
            console.log(
              `[export-csv] 완료 rows=${sentRows} total=${totalRows} ms=${Date.now() - startedAt}`,
            );
            release();
            controller.close();
            return;
          }
          sentRows += value.length;
          controller.enqueue(encoder.encode(rowsToCsvChunk(value, profiles)));
        } catch (err) {
          // 중간 실패는 스트림 오류로 명시화 — 부분 파일이 정상 다운로드처럼 보이지 않게
          console.error(`[export-csv] 실패 rows=${sentRows}`, err);
          release();
          controller.error(err);
        }
      },
      async cancel() {
        // 클라이언트 중단(다운로드 취소·연결 끊김)
        // eslint-disable-next-line no-console -- 내보내기 관측 로그(시작/완료/행수/소요) 의도적 유지
        console.log(`[export-csv] 중단 rows=${sentRows}`);
        release();
        await gen.return(undefined as never).catch(() => {});
      },
    });

    // eslint-disable-next-line no-console -- 내보내기 관측 로그(시작/완료/행수/소요) 의도적 유지
    console.log(
      `[export-csv] 시작 worker=${workerId ?? "all"} from=${from} to=${to} total=${totalRows}`,
    );

    return new Response(stream, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${csvFilenameFor(workerId, from, to)}"`,
        // 스트리밍 시작 시점의 COUNT — 진행 중 신규 적재분이 뒤에 포함될 수 있어 참고값
        "x-row-count": String(totalRows),
        "x-site-info-rows": String(siteInfoRows.length),
      },
    });
  } catch (err) {
    release();
    throw err;
  }
}
