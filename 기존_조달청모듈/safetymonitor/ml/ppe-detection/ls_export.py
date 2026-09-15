# Label Studio 로컬 DB 에서 라벨을 읽어 YOLO txt 로 내보낸다. 브라우저 Export 를 쓰지 않는 이유가 둘이다.
#   ① 업로드 파일명에 해시가 붙어(81848a7e-IMG_2224.JPG) 사진과 짝이 안 맞는다 — 5차 평가를 무효화한 자리다.
#   ② 내려받기는 ~/Downloads 로 가는데 그 경로가 상시 차단이라 검수 스크립트가 못 읽는다.
# 박스마다 붙인 태그(방향·색·신발·확신)는 txt 에 자리가 없어 사이드카 JSON 으로 따로 뺀다.
import json, os, re, sqlite3, sys, collections

NAMES = ["person", "head", "helmet", "safety_vest", "foot",
         "shoes", "hands", "gloves", "no_safety_shoes"]   # v6 가중치 정본 순서
IDX = {n: i for i, n in enumerate(NAMES)}
DB = os.path.expanduser("~/Library/Application Support/label-studio/label_studio.sqlite3")


def stem_of(data):
    """{"image": "/data/upload/1/<해시>-IMG_2224.JPG"} 에서 원본 이름만 되찾는다."""
    f = os.path.basename(json.loads(data).get("image", ""))
    return os.path.splitext(re.sub(r"^[0-9a-f]{8}-", "", f))[0]


def main(outdir, project=None):
    c = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    q = ("select t.data, a.result from task t join task_completion a on a.task_id = t.id"
         + (" where t.project_id = ?" if project else ""))
    rows = c.execute(q, (project,) if project else ()).fetchall()

    os.makedirs(outdir, exist_ok=True)
    cnt, tags, unknown, n_box = collections.Counter(), {}, collections.Counter(), 0
    for data, result in rows:
        stem = stem_of(data)
        res = json.loads(result)
        boxes, per_region = [], collections.defaultdict(dict)
        for e in res:
            if e["type"] == "rectanglelabels":
                v = e["value"]
                name = v["rectanglelabels"][0]
                if name not in IDX:
                    unknown[name] += 1
                    continue
                # LS 는 좌상단 기준 백분율이다. YOLO 는 중심 기준 0~1 이다.
                cx = (v["x"] + v["width"] / 2) / 100.0
                cy = (v["y"] + v["height"] / 2) / 100.0
                boxes.append((IDX[name], cx, cy, v["width"] / 100.0, v["height"] / 100.0))
                cnt[name] += 1
            elif e["type"] == "choices":
                per_region[e["id"]][e["from_name"]] = e["value"]["choices"]
        n_box += len(boxes)
        with open(os.path.join(outdir, stem + ".txt"), "w") as f:
            for b in boxes:
                f.write("%d %.6f %.6f %.6f %.6f\n" % b)
        if per_region:
            tags[stem] = per_region

    side = os.path.join(outdir, "_tags.json")
    if tags:
        json.dump(tags, open(side, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    print(f"사진 {len(rows)}장 · 박스 {n_box}개 → {outdir}")
    for n in NAMES:
        if cnt[n]:
            print(f"  {n:16s} {cnt[n]}")
    if unknown:
        print(f"  ⚠ 정본 9클래스에 없는 이름 {dict(unknown)} — 건너뛰었다")
    print(f"  태그 {'→ ' + side if tags else '0개 (박스만 그렸다)'}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("쓰기: python3 ls_export.py <출력 labels 디렉터리> [project_id]")
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
