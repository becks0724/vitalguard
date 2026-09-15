# 설계 — 화면의 모델명을 엣지에서 받아온다 (2026-09-15)

## 0. 왜

관제웹 푸터가 **`YOLO26s v5`** 로 하드코딩돼 있는데(`CctvQuadView.tsx:58`) 라이브는 **v7d** 다.
같은 화면 안에서 엣지 오버레이(`PPE yolo26 v7d@544x960`)와 **모순**이다.

★ **그 코드의 주석이 이미 이 사고를 예측했다.**
> 엣지가 프레임에 굽는 오버레이와 어긋나면 **한 화면에서 모순**이 된다

⚠ 그리고 **이미 한 번 낡은 것을 못 잡았다** — 주석의 근거가 `ppe_yolo26s_640_v5_nc`(정사각)인데
실제는 09-12 에 `rect544x960`(직사각)으로 바뀌었다. **사람이 기억하는 방식은 두 번 실패했다.**

## 0-1. ⛔ 설계를 한 번 정정했다 — **경로를 잘못 짚었다**

처음에 「엣지 push → cctv-ai `/cctv/ingest3` → 관제웹」으로 설계했다. **틀렸다.**

```
확인된 사실
  젯슨 env 에 CCTV_BASE 가 **없다** ⟹ 푸셔는 서버로 push 를 안 한다(로컬 전용·과금 0)
  그런데 관제웹에는 CAM-03 화면이 뜬다 ⟹ 다른 경로다
  cctv_gate.py:216-231  관제웹 → 젯슨 게이트 /cctv/stats3 → **푸셔 /health** 를 직접 읽는다
  그 게이트가 **화이트리스트**로 5개 키만 통과시킨다
```

⟹ **`cctv-ai`(Cloud Run)를 안 거친다.** 내가 처음 고친 `main.py`(ingest3)는 폰 업로드 경로용이고
**이 문제를 안 고친다.** 무해하지만 효과도 없다.

★ 원인 = **경로를 코드로 안 따라가고 「push 라니까 push 경로겠지」로 갔다.**
오늘 네 번째 같은 병이다 — 호출부·상류를 안 읽고 중간만 보고 단정했다.

### 정정된 수정 지점

| # | 대상 | 무엇을 |
|---|---|---|
| ① | 푸셔 `gopro_ppe_edge.py` | `stats` 에 `engine` 추가 (`/health` 로 나간다) |
| ② | **게이트 `cctv_gate.py`** | 화이트리스트에 `engine` 한 키 추가 |
| ③ | 관제웹 `CctvQuadView.tsx` | `stats.engine` 사용 · 폴백 유지 |

⟹ **`cctv-ai` 배포가 불필요하다.** 젯슨 둘(푸셔·게이트) + 관제웹 하나.
⚠ `main.py` 의 `ingest3` 수정은 **되돌리지 않는다** — 폰 업로드 경로에서는 여전히 맞는 개선이고,
그 경로가 다시 주 경로가 되면 그때 필요하다.

---

## 1. 현재 흐름 (코드 확인)

```
엣지   gopro_ppe_edge.py:606-613
       POST {CCTV_BASE}/cctv/ingest3?drawn=1&persons=..&violations=..&compliance=..
                                     &hardhat=..&no_hardhat=..
       ⟹ 카운트만 간다. 모델명 없음

서버   cctv-ai/main.py:848-853  (drawn=1 분기)
       st = {person_count, fall_count, violation_count, compliance_rate,
             no_hardhat_count, hardhat_count, no_vest_count, vest_count}
       _ppe_live["stats"] = st

조회   GET /cctv/stats3 → _ppe_current_stats() → 위 st 그대로

관제웹 CctvQuadView.tsx:603-611  useAiStats<{...}>  타입에 engine 없음
       :58  AI_MODEL_LABEL.ppe = "YOLO26s v5"  ← 하드코딩
```

## 2. 바꿀 것 — 세 곳, 각 1~2줄

### ① 엣지 — 보낸다
```python
# gopro_ppe_edge.py:606  urlencode 에 한 줄
"engine": ENGINE_TAG,          # 화면이 어느 모델인지 스스로 말하게 한다
```

### ② 서버 — 받아서 저장한다
```python
# cctv-ai/main.py:848  st 딕셔너리에 한 줄
"engine": (q.get("engine") or "")[:24],   # 길이 상한 — 화면 폭과 무해성 둘 다
```

### ③ 관제웹 — 있으면 쓰고 없으면 폴백
```typescript
// CctvQuadView.tsx  타입에 engine?: string 추가
// 표시부:  stats?.engine ? `YOLO26s ${stats.engine}` : AI_MODEL_LABEL.ppe
```

## 3. ★ 핵심 — 하위 호환. 각 단계가 **혼자서도 안전**해야 한다

세 시스템의 배포 시각이 다르므로 **어느 순서로 나가도 깨지지 않아야** 한다.

| 상태 | 결과 |
|---|---|
| 엣지만 배포 (서버 구버전) | 서버가 `engine` 쿼리를 **무시**한다 → 무해 |
| 엣지+서버 (관제웹 구버전) | `stats3` 에 키가 하나 늘 뿐 → 관제웹이 **안 읽으므로** 무해 |
| 관제웹만 배포 (엣지 구버전) | `stats.engine` 이 `undefined` → **하드코딩 폴백**으로 표시 |
| 셋 다 | 엣지 값이 화면에 |

⟹ **배포 순서를 강제하지 않는다.** 이것이 이 설계의 유일한 제약이다.

## 4. ⚠ 안전 조건

```
길이 상한   서버에서 24자로 자른다 — 엣지가 이상한 값을 보내도 화면이 안 깨진다
문자 제한   ENGINE_TAG 는 파일명에서 뽑은 영숫자·언더스코어라 URL 인코딩 안전
폴백 유지   AI_MODEL_LABEL.ppe 를 지우지 않는다 — 엣지 미수신·클립 폴백 경로가 있다
빈값        서버가 "" 로 저장하면 관제웹은 폴백을 쓴다(빈 문자열은 falsy)
```

⚠ **`AI_MODEL_LABEL.ppe` 를 지우면 안 된다.** cctv-ai 가 번들 클립을 Hexmon 으로 추론하는
폴백 경로가 있고, 그때는 엣지 값이 없다.

## 5. 배포 — 정정 후 둘이다

| # | 대상 | 방법 | 담당 |
|---|---|---|---|
| ① | 젯슨 **푸셔 + 게이트** | `deploy_edge.sh` + **각각 재시작** | [CCTV/ML] |
| ② | `dashboard-web` | Cloud Run | [WATCH.APP] · 사용자 `/deploy` |
| — | ~~`cctv-ai`~~ | **불필요** — 이 경로를 안 거친다 | |

⚠ **게이트도 재시작해야 한다**(PID 54106 · 8443). 푸셔와 별개 프로세스다.
★ **①만 먼저 해도 된다**(§3) — 관제웹 구버전은 폴백으로 떨어진다.

## 6. 검증

```
① 엣지    push 로그 또는 서버 접근 로그에 engine= 이 찍히는지
② 서버    curl {AI}/cctv/stats3 | jq .engine  → "v7d"
③ 관제웹  화면 푸터가 "YOLO26s v7d" 로 · 엣지를 끄면 폴백 "YOLO26s v5" 로
통제군    엣지에서 engine 을 빼고 보내 → 서버 "" → 화면이 폴백으로 떨어지는지
```

⚠ **통제군이 중요하다.** 「값이 흐른다」만 보면 **폴백이 죽어 있어도 초록**이다.

## 7. 남는 것 — 이 설계가 안 푸는 것

```
포즈 모델명   화면에 자세 표기가 따로 있는데 그건 엣지 오버레이에만 있다
클립 폴백     Hexmon 경로의 모델명은 여전히 서버가 안다(엣지 무관)
CAM-02        낙상은 FALL_SOURCE_LABEL 로 별도 처리 중
```

---

## 8. 저장소 반영 — 09-15 추가 (main 대조 실측)

[WATCH.APP] 이 팀원 PR #20 머지(`origin/main = 1ac942ed`)를 알리며 **파일 복사 금지**를
짚었다. merge-base `9b723009` 기준으로 main 이 분기 후 건드린 커밋 수를 세면 이렇다.

```
main.py             0건
cctv_gate.py        2건   (07df7441 신설 · a4b6e1f4 CORS)
gopro_ppe_edge.py   5건   (bcfbd653 젯슨 실물 동기화 292→717 외 4건)
CctvQuadView.tsx    3건   (da240542 · 8c6033b1 · 2a465351 · 126줄)
```

### ⛔ 여기서 멈추면 틀린다 — 커밋 수는 계보만 센다

처음엔 넷 다 같은 위험으로 봤다. 그런데 **계보 밖으로 들어온 내용은 커밋 수에 안 잡힌다.**
이 저장소의 엣지 파일이 정확히 그 경우다 — 젯슨 실물을 복사해 오는 경로라 `bcfbd653` 이
조상이 아닌데도 그 내용이 전부 들어 있다.

### 내용으로 다시 잰 결과

| 파일 | merge-base | main | tmp-507e | 판정 |
|---|---|---|---|---|
| `gopro_ppe_edge.py` | 292줄 | 1047줄 | **1465줄** | main 이 뒤처짐 |
| `cctv_gate.py` | 없음 | 266줄 | **271줄** | main + 내 5줄 |
| `CctvQuadView.tsx` | 864줄 | **938줄** | 945줄 | ⚠ **내가 뒤처짐** |

`gopro_ppe_edge.py` 손실 검사.

```
표지        /netstat 2 · jpeg_q 7 · /capture 2   — main 과 동일
라우트      main 전용 0건 · 내 쪽 추가 3건(/clip · /collect · /record)
기능 표지   PPE_IMGSZ · vest_count · no_vest_count · push_workers · PoseLog · train_ref 전부 생존
사라진 27줄  ⓐ 의도 수정(ENGINE v5→v7d · _mv 정규식 · 헤더 cands) ⓑ 줄바꿈 재배치
            유일한 실삭제 = 로컬 화면 <span id="engine"> 하나(정보는 헤더로 옮겨감)
```

⚠ 통제군을 같이 돌렸다 — 없는 문자열을 넣어 「없다」가 나오는지 확인했다(검사가 눈멀지 않음).

### 결정적 근거 — 젯슨 실물 md5

```
19459e6cbb58fdcdeec1561e6f037862  1465줄  /home/jetson/vg_edge_poc/gopro_ppe_edge.py
e4eafb4255c274af89f1c8fba0eba04b   271줄  /home/jetson/vg_edge_poc/cctv_gate.py
```

내 tmp-507e 사본과 **바이트 단위로 같다.** main 것은 09-10 스냅샷이다.

### 그래서 옮기는 방식이 파일마다 다르다

```
CctvQuadView.tsx    패치로 11줄만   (내가 뒤처져 있다 — 복사하면 main 3커밋이 사라진다)
gopro_ppe_edge.py   파일 통째로     (내가 상위집합이다 — 패치를 뜨면 27줄 재배치가 충돌원)
cctv_gate.py        파일 통째로     (같은 이유)
main.py             불필요          (이 경로를 안 거친다)
```

★ **옮겨야 하는 이유** = 메모리 `v5-not-v6-is-deployed` 의 09-14 위험을 닫는다.
*"저장소본이 젯슨 구동본보다 뒤처짐 — 저장소본으로 엣지를 되살리면 09-12 수리(직사각 ·
HEAD_CONF 0.30)가 되돌아가 오경보 2.7배."* 지금 안 옮기면 그 위험이 그대로 남는다.

### 체크리스트

- [x] merge-base 기준 main 커밋 수 측정 (4파일)
- [x] 커밋 수가 아니라 **내용**으로 재측정 (라우트·기능 표지·삭제줄 분류)
- [x] 통제군 — 없는 문자열이 「없다」로 나오는지
- [x] 젯슨 실물 md5 대조 (2파일 일치)
- [x] [WATCH.APP] 에 회신 — 안 B 동의 + cctv-ai 는 같이 옮기기를 요청
- [x] [WATCH.APP] 반영 완료 — `origin/main 04c49cea` (tsx 패치 11줄 · 엣지 2파일 통째 교체)
- [x] 반영분 **독립 대조** (아래 §9)
- [ ] `dashboard-web` 배포 (사용자 `/deploy` 필요) ⬅ **대기 중인 유일한 항목**
- [ ] 배포 후 §6 검증 3종 + 통제군

---

## 9. 반영 결과 독립 대조 — 09-15

`origin/main 04c49cea`. [WATCH.APP] 이 파일마다 방법을 달리 적용했고, 내가 그쪽 자를 쓰지 않고
다시 쟀다.

### CctvQuadView.tsx — 패치 11줄 (공존 확인)

```
내 11줄    engine?: string 1 · const ppeModel 1 · stats?.engine 1 · `YOLO26s ${stats.engine}` 1
main 3커밋  GateLiveScreen 3 · CAM03_GATE_API 2 · 「위반 없음」 2
소비처      :663 · :684 두 곳 연결 · AI_MODEL_LABEL.ppe 직접 참조는 :621 폴백 한 곳뿐
통제군      없는 문자열 → 0건 (검사가 눈멀지 않음)
```

★ **:60 `ppe: "YOLO26s v5"` 폴백줄 생존이 제일 중요했다.** Hexmon 클립 경로가 이 값을 쓰는데,
겉으로는 「이제 안 쓰는 하드코딩」으로 보여서 지워지기 가장 쉬운 줄이다.

### 엣지 2파일 — 통째 교체 (젯슨 실물 재대조)

```
19459e6cbb58fdcdeec1561e6f037862  gopro_ppe_edge.py   main = 젯슨 실물 일치
e4eafb4255c274af89f1c8fba0eba04b  cctv_gate.py        main = 젯슨 실물 일치
```

⟹ 저장소가 구동본과 같아졌다. §8 에 적은 09-14 위험이 닫혔다.

### ⚠ 줄 수가 갈렸다 — 자가 달랐던 것

[WATCH.APP] 864/938/945 vs 내 910/985/992. `wc -l` 로 통일해 다시 재니
`1ac942ed 985 → 04c49cea 992 = +7줄`, `git diff --stat` 의 9삽입−2삭제와 정확히 맞는다.
결론에는 영향이 없었지만 [[measure-both-sides-same-way]] 그대로다 — **숫자에 자를 붙여 주고받는다.**

### 배포 때 볼 두 줄

```
빌드 로그   _CAM03_GATE=https://cctv-gate.example.invalid:8443   (아무도 안 넘겨도 찍혀야 함)
화면 PPE 줄  「YOLO26s v5」 → 「YOLO26s v7d」                       (엣지가 engine 을 보내면)
```

⚠ **화면이 v5 면 관제웹 탓이 아닐 수 있다.** 젯슨 v7d 가 env 로 떠 있어서 재부팅하면 v5 로 돌아간다
([[v5-not-v6-is-deployed]]). 코드 기본값 영속화는 `258774c7` 로 저장소에 들어갔지만 **구동 중인
프로세스는 옛 방식**이다. 판정 순서 = ① 게이트 `/cctv/stats3` 의 `engine` → ② 화면.

### 별건 — tmp-507e 에 내 것이 아닌 커밋

```
19106aac  feat(ppe-ml): 클래스 우선순위를 게이트에 박는다
          Claude-Session: session_01WhuaQi71mJ6pDQCoozAYao   (내 것은 …01EyWN42…)
```

내 브랜치 HEAD 인데 내가 만들지 않았다. push 담당에게 전달했다. tmp-507e 는 origin/main 대비
286커밋이라 **통째로 밀 대상이 아니다**(08-12 분기 이후 로컬 문서가 대부분).

---

## 10. ⚠ 라이브 cctv-ai 가 저장소보다 앞서 있다 — 09-15 포렌식

[WATCH.APP] 이 *"89e524c9 는 4파일인데 3만 옮겼다"* 를 짚었다. 내가 첫 회신에서 `main.py` 를
**「이 경로를 안 거치니 불필요」**라고 적었는데, 그건 **engine 라벨 경로에 대해서만 참**이었다.
그 파일에 딸린 다른 위험을 안 봤다.

### 포렌식 경로

```
라이브        cctv-ai-00083-qq7  (생성 2026-09-07 14:51 KST)
이미지        sha256:7dce0df768fbd8281162dd92591c9f492a9bc225e259cac50352b47260eb446f
빌드          683a3f64-e625-4559-be2c-eaa050421d6f  (09-07 11:39 KST)
소스          gs://safetymonitor-498508_cloudbuild/source/
              1788748752.267314-9814a3880f4f426a9532de14c3dac7e4.tgz
```

### 대조 — main.py

| 판 | md5 | 줄 |
|---|---|---|
| **빌드 소스** | `04307735ed77723f6cc2d79ffcebdc40` | 904 |
| **`703f387c`** | `04307735ed77723f6cc2d79ffcebdc40` | 904 |
| `origin/main` | `5047b5736a0826bccb9255f58e38c4e7` | 896 |
| `89e524c9` · `HEAD` | `37404cd41f989ed08af7ac19e41efd4a` | 908 |

★ **빌드 소스 = `703f387c`, 바이트 동일.** 통제군 = 없는 문자열 0건 · `STREAM3_FPS` 빌드 소스 3건.

⟹ **라이브 cctv-ai 는 09-07 부터 `703f387c` 를 돌리는데 `main` 은 그것을 모른다. 12줄 낡았다.**

### 왜 지금이 아니라 「다음에 누가 배포할 때」 터지나

지금 `main` 에서 cctv-ai 를 빌드하면 `703f387c` 가 되돌아간다.

```
STREAM3_FPS 상한 env      사라짐 → CAM-03 송출이 엣지 푸시율과 어긋남
동일 프레임 재송출 제거    사라짐 → 같은 프레임을 반복 송출
1초 keepalive             사라짐
```

[[v5-not-v6-is-deployed]] 의 09-14 젯슨 건과 **같은 계열**이다. 오늘 젯슨 엣지 2파일로 그 구멍을
닫았는데, cctv-ai 에 같은 구멍이 **8일째** 열려 있었다.

★ **세 곳 중 두 곳을 닫고 한 곳을 남길 이유가 없다.**

### ⚠ 이건 배포가 아니다

`main.py` 를 main 에 올려도 **cctv-ai 는 재배포하지 않는다.** 라이브가 이미 그 코드를 돌고 있어
배포할 것이 없고, 지금 배포하면 오히려 오늘 것(`89e524c9` engine 중계)까지 나가 검증 안 된
변경이 프로덕션에 들어간다. **저장소만 맞추는 일이다.**

### 교훈 — 「안 거친다」는 한 경로에 대한 답이다

`main.py` 가 engine 라벨 경로에 안 쓰이는 것은 맞았다. 틀린 것은 **그 답으로 파일 전체를
판정한 것**이다. 파일은 경로 하나만 지나가지 않는다.
[[deleting-a-box-teaches-absence]] 의 「기각 전에 그 가설이 참일 수 있는 자리를 전부 센다」와
같은 형태다 — 방법이 아니라 **범위**가 틀렸다.

### 체크리스트

- [x] 89e524c9 가 4파일임을 확인 (내가 3이라 했다)
- [x] 라이브 리비전 → 이미지 → 빌드 → 소스 tarball 역추적
- [x] `main.py` 네 판 md5 대조 + 통제군
- [x] [WATCH.APP] 에 회신 — 둘 다 올릴 것 · 재배포는 하지 말 것
- [ ] `main.py` 2커밋 + 이 문서를 main 에 (사용자 승인 후 [WATCH.APP])
- [ ] `gate_e2e.py` 를 `/cctv/stats3` 로 — engine 키 **유무가 아니라 값**을 볼 것
      (`str(... or "")` 라 푸셔가 안 보내도 키는 `""` 로 생긴다)

---

## 11. 게이트 응답 실측 — 빈 칸이 채워졌다 (09-15 · [WATCH.APP])

내가 못 잰 칸을 [WATCH.APP] 이 `gate_e2e.py` 로 채웠다. 티켓이 공개키 서명이라 젯슨에서는
만들 수 없고 관제웹 쪽에서만 만들 수 있다.

```
1) 관제웹 로그인          HTTP 200
2) /api/cctv/ticket       HTTP 200 · ttl 60초 (cameraId=CAM-03 · scope=read)
3) 게이트 /cctv/stats3    HTTP 200
   {"compliance_rate":0,"engine":"v7d","hardhat_count":0,
    "no_hardhat_count":2,"person_count":2,"violation_count":2}
```

★ **`engine == "v7d"`.** 키 유무가 아니라 값으로 판정했다 — 게이트가 `str(s.get("engine") or "")`
라서 푸셔가 안 보내도 키는 `""` 로 생기기 때문이다.
★ **통제군** = `person_count 2` · `no_hardhat_count 2` · `violation_count 2` 가 0 이 아니다
⟹ 게이트가 업스트림을 실제로 읽고 있다. engine 만 봤으면 못 가렸다.
덤으로 서명·검증 경로도 증명됐다(관제웹 개인키 서명 → 게이트 공개키 통과).

### 경로 표 — 남은 미지는 하나다

```
푸셔 /health          stats.engine = 'v7d'          ✅
게이트 코드 :235      out["engine"] = …             ✅
게이트 프로세스 기동   파일 mtime 보다 20초 뒤        ✅
게이트 응답           engine: "v7d" + 통제군         ✅  ← 09-15 채움
브라우저 화면          ?                             ⬅ 배포 후, 변경 주인이 본다
```

## 12. ⚠ Ⓑ(조끼 판정) 착수자가 먼저 볼 것 — 타입이 거짓말을 한다

`CctvQuadView.tsx:610,612` 가 이렇게 선언한다.

```typescript
    no_vest_count: number;      // 비옵셔널
    vest_count: number;         // 비옵셔널
```

그런데 **게이트가 이 두 키를 안 보낸다**(§9 화이트리스트). 런타임엔 `undefined` 가 온다.
지금은 아무 데서도 안 읽어서 조용하다.

⛔ **Ⓑ 로 조끼 판정을 되살릴 때 여기가 함정이다.**
```
stats.no_vest_count > 0     타입검사 통과(number)  ·  런타임 undefined > 0 → 조용히 false
```
경보가 안 울리는데 빨간불도 안 뜨고 에러도 없다. [[output-exists-but-nothing-was-measured]] 그대로다.

**착수 순서** = ① 게이트 화이트리스트에 두 키 추가 → ② 푸셔 `no_vest_count` 구현 →
③ 화면. **①을 먼저** 해야 ②를 실측으로 확인할 수 있다.

## 13. 줄 수가 또 갈렸다 — 이번엔 자가 아니라 시각이었다

[WATCH.APP] 267 vs 내 211. 같은 명령(`git show <ref>:<경로> | wc -l`)인데 갈렸다.

```
89e524c9  105줄      c9dbaf26  211줄  ← 내가 말한 시각
d23dd070  267줄  ← 그쪽이 잰 시각      83cacf81  336줄  ← 지금
```

★ **둘 다 맞았다. 문서가 작업 중에 자라고 있었다.**
§8 에서 겪은 「자가 다르다」와 겉모습이 같아서 또 자 문제로 볼 뻔했다.
⟹ 수를 주고받을 때 **명령만으로는 부족하고 `<ref>` 를 같이** 준다. 배포 런북 L-125 ⓕ 의
*"확인 중에 목록이 자라므로 SHA 로 주고받고 밀기 직전에 다시 센다"* 와 같은 형태다.

### 체크리스트

- [x] 게이트 `/cctv/stats3` 응답에 `engine: "v7d"` — 통제군 포함
- [x] 줄 수 불일치 원인 규명 (자가 아니라 시각)
- [x] Ⓑ 함정을 문서에 박음 (비옵셔널 타입 + 미전송 키)
- [ ] 브라우저 화면 확인 — 배포 후, 내가 본다

---

## 14. ★★ 젯슨 전수 대조 — 낙상 판정 정본이 main 에 없다 (09-15)

[WATCH.APP] 이 *"09-14 되반영 가드(README 84줄)가 main 에 없다"* 를 짚었다. 그 김에 젯슨을
전수로 훑었더니 **README 보다 등급이 높은 것**이 나왔다.

### pose_fall.py — 기동 차단

```
젯슨 실물      f7d73985dd29059d5ed462471828ce43   566줄
tmp-507e      f7d73985dd29059d5ed462471828ce43   566줄   ← 바이트 동일
origin/main   파일 자체가 없음
```
```python
gopro_ppe_edge.py:444    if people:
                             import pose_fall as _pf      ← 사람이 잡힐 때마다
```

⛔ **`main` 으로 엣지를 되살리면 사람이 잡히는 순간 `ImportError` 로 죽는다.**
오늘 닫은 다른 것들은 「기능이 조용히 되돌아간다」였다. 이건 **기동이 안 된다.** 등급이 다르다.

### 올릴 목록 — 등급별로 커밋을 쪼갠다 ([WATCH.APP] 요청)

| 등급 | 파일 | 근거 |
|---|---|---|
| **1 · 기동 차단** | `edge/pose_fall.py` | 젯슨 실물과 동일 · 푸셔가 import |
| **2 · 실물 동기화** | `gopro_ppe_push.py` `orbbec_cctv_push.py` `cam03_view_server.py` `pose_log_stat.py` `nvdec_probe.py` `bench_ppe_pose.py` | 전부 md5 = 젯슨 실물 |
| **3 · 저장소측 도구** | `deploy_edge.sh` `lagwatch.sh` `mjpeg_lag.py` | 젯슨엔 없음 · README 가 가리킴 |
| **4 · 문서** | `rule-plan-20260913/deploy-yolo11s-20260914.md` | 09-14 배포 기록 · 1등급과 짝 |

⚠ **올리되 재배포·재기동은 하지 않는다.** 젯슨은 이미 이 코드를 돌고 있다.

### 안 올리는 것

젯슨에만 있는 일회성 분석 스크립트 20개(`check_distance.py` · `conf_gradient.py` ·
`scene_clusters.py` 류). 브랜치에도 없고 재현 가치가 없다 — 필요하면 젯슨에서 다시 만든다.

### 남는 것 — 손대지 않는다

`main` 의 README 가 **가리키는데 어디에도 없는 파일 8개**가 있다
(`dash_push.py` `detector.py` `docker.sh` `download.py` `j.py` `r.py` `ros2_orbslam2.sh`
`run_docker.sh`). 오늘 작업이 만든 것이 아니라 이전부터 있던 문서 드리프트다. 기록만 한다.

### ⛔ 내 측정이 한 번 거짓 초록이었다 — 1개 vs 27개

처음엔 `while read` 안에서 `ssh` 를 돌렸다.
```
while read -r f; do ... ssh jetson "md5sum ..." ... done < 목록.txt
```
**안쪽 `ssh` 가 stdin 을 먹어** 목록이 두 번째 줄에서 끊겼다. 출력은 멀쩡해 보였고
「main 에 없는 건 1개」라고 나왔다. 실제는 **27개**였다.

```
고침    젯슨 해시를 ssh 한 번으로 먼저 받아 두고, 순회는 로컬에서만 한다
        (ssh -n 도 같은 효과)
통제군  젯슨 31개 중 main 에 있는 것 4개 — 0 이 아니므로 경로는 맞다
```
★ **눈으로는 못 잡는다.** 1도 27도 그럴듯한 수다. 같은 함정이 `adb shell` 에도 있다
([[watch-adb-wifi-mediator]]). [[output-exists-but-nothing-was-measured]] 그대로다.

### 교훈 — 「배포했다」와 「저장소에 있다」를 따로 묻는다

`pose_fall.py` 를 나는 **「젯슨에 배포했다」로만 기억**하고 있었다. 「main 에 있나」를 한 번도
안 물었다. [WATCH.APP] 이 자기 메모리에서 찾은 것과 같은 병이다 — 메모리에 *"근본 대응 =
README 에 신설"* 이라고만 적으면 다음 세션이 **「있다」고 믿는다.**
⟹ **배선을 적을 때 `ref` 까지 적는다.**

### 체크리스트

- [x] 젯슨 31파일 전수 대조 (ssh 함정 수정 후 · 통제군 4/31)
- [x] `pose_fall.py` 가 런타임 import 임을 코드로 확인 (`:444` · `if people:` 안)
- [x] 올릴 목록 4등급으로 확정 · [WATCH.APP] 에 전달
- [ ] 사용자 승인 후 push (등급별 커밋 분리)
- [ ] 관제웹 배포 후 화면 v7d 확인 ⬅ 내 몫

---

## 15. 푸셔 systemd 유닛 — 09-15 사용자 결정

오늘 나온 것 중 **유일하게 안 닫혀 있던 구멍**이다.

```
cctv-gate.service   systemd · enabled          ✅ 재부팅 생존
푸셔                PPID 1 (수동 기동)          ⛔ 유닛 없음 · cron 없음
POSE_FALL 기본값 "0" (:98)                      → env 빠뜨리면 낙상만 조용히 죽는다
```

### 결정 = `Restart=no` (사용자)

GoPro 가 웨지되면 프로세스를 되살려도 안 듣는다(물리 재연결이 필요하다). 자동 재시작은 그
상황에서 죽고 살아나기를 반복해 상태만 악화시킨다. **재부팅만 커버하고 장애 때는 사람이 올린다.**

정본 = `cctv-ai/edge/cctv-pusher.service` (저장소에 있다 — 젯슨에만 두면 오늘 다섯 번 본 얼굴이
여섯 번째가 된다).

### 설치 — 구동 중인 푸셔를 건드리지 않았다

```
sudo cp cctv-pusher.service /etc/systemd/system/ && sudo systemctl daemon-reload
sudo systemctl enable cctv-pusher.service          ← --now 를 붙이지 않는다
```
```
설치 전 PID 322586  →  설치 후 PID 322586        ✅ 무중단
cctv-pusher.service  enabled · inactive          ← inactive 가 정상(수동분이 돌고 있다)
cctv-gate.service    enabled · active
유닛이 현재 구동값을 재현하나   cwd·env(POSE_FALL=1 POSE_LOG=1)·명령 전부 일치
```

### ⛔ 내 첫 검증이 거짓 초록이었다

`systemd-analyze verify` 를 돌리고 **「출력 없음 = 문제 없음」이라고 찍었는데 출력이 있었다.**
다른 유닛(`yahboom_oled` · `snapd` · `nvargus-daemon` …)에 대한 경고였고 내 유닛 것은 아니었지만,
내 판정 로직은 그것을 가르지 않고 무조건 초록을 냈다.

```
고침    systemd-analyze verify … | grep -i "cctv-pusher"      → 0건이어야 통과
통제군  일부러 깨진 유닛(ZZZBadKey)을 넣어 잡히는지 확인      → 잡혔다
```
★ **검사기가 다른 것을 지적한 출력을 「내 것이 깨끗하다」로 읽지 않는다.**

### ⚠ 아직 확인 못 한 것 — 실제 부팅

`enable` 은 됐고 문법도 통과했지만 **재부팅해서 실제로 뜨는지는 못 봤다.** 재부팅할 수 없고,
수동분을 내리고 `systemctl start` 로 바꿔 띄우는 시험은 CCTV 가 잠시 끊긴다
([[measure-the-undo-when-you-add-it]] — 09-15 에 내려놓고 못 올린 전례가 있다).

⟹ **다음 재부팅이 첫 시험이다.** 그때 볼 것.
```
systemctl status cctv-pusher.service       active (running) 인가
curl -s localhost:8444/health              stats.engine = v7d 인가
journalctl -u cctv-pusher -n 30            기동 실패면 여기 이유가 남는다
```

### 체크리스트

- [x] 유닛 설계 — `Restart=no` · env 포함 · `CCTV_BASE` 제외(과금 0 유지)
- [x] 저장소에 정본 작성 (`cctv-ai/edge/cctv-pusher.service`)
- [x] 젯슨 설치 + `enable` — 구동 중 푸셔 PID 불변 확인
- [x] 문법 검증 + 통제군(깨진 유닛이 잡히는지)
- [ ] **다음 재부팅에서 실제 기동 확인** ⬅ 미검증으로 남는다
