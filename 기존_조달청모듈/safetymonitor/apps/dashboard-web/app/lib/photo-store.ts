// 사진대지 파일 저장소(서버) — 현장(contractId)별 .runtime/photos/<id>/ 에 실제 파일 저장 + 매수 카운팅.
//   주간보고서 ④증빙 축의 실 데이터 소스. (실서비스: 관리자앱 업로드 → 동일 흐름)
import "server-only";
import path from "node:path";
import fs from "node:fs";

function dirFor(contractId: string): string {
  const safe = contractId.replace(/[^A-Za-z0-9_-]/g, "_") || "unknown";
  // dev cwd = apps/dashboard-web → 모노레포 루트 .runtime 아래 저장(db.ts 와 동일 위치)
  return path.resolve(process.cwd(), "..", "..", ".runtime", "photos", safe);
}

export async function savePhotos(contractId: string, files: File[]): Promise<number> {
  const dir = dirFor(contractId);
  fs.mkdirSync(dir, { recursive: true });
  let i = 0;
  for (const f of files) {
    const buf = Buffer.from(await f.arrayBuffer());
    const base = f.name.replace(/[^A-Za-z0-9._-]/g, "_") || `photo_${i}`;
    fs.writeFileSync(path.join(dir, `${Date.now()}_${i}_${base}`), buf);
    i += 1;
  }
  return countPhotos(contractId);
}

export function countPhotos(contractId: string): number {
  try {
    return fs.readdirSync(dirFor(contractId)).filter((f) => !f.startsWith(".")).length;
  } catch {
    return 0;
  }
}

export function listPhotos(contractId: string): string[] {
  try {
    return fs.readdirSync(dirFor(contractId)).filter((f) => !f.startsWith("."));
  } catch {
    return [];
  }
}
