# 조사 의뢰 — CCTV 측정이 404 로 막혔다 (코드로만 답할 것)

작성: Claude / 수신: 코덱스(astra) / 2026-09-13

## ⛔ 규칙

- **읽기만 해라. 파일을 고치지 마라. 커밋하지 마라.**
- **네트워크를 쓰지 마라.** 샌드박스가 막혀 있고, 라이브 확인은 내가 한다.
- 추측하지 마라. **파일·줄 번호를 인용**하거나 "모른다"고 해라.
- 티켓 값·키·주소 실값을 답변에 적지 마라.

## 무슨 일이 있었나

태블릿 앱에 측정 화면(`app/vitalguard_field/lib/cctv_probe_screen.dart`)을 넣고,
URL 칸에 `<cctv-ai Cloud Run 오리진>/cctv/stream3` 을, 티켓 칸에 관제웹에서 발급한 티켓 1장을
붙여넣고 5초 주기로 GET 했다. 결과는 **`HTTP 404`** 하나뿐이었다.

## 내가 이미 확인한 것 (다시 하지 마라)

기준 트리: `/Users/rlaxorhs77/Desktop/조달청 프로젝트/조달청_rlaxorhs77eng/기존_조달청모듈/safetymonitor`

| 확인한 것 | 결과 |
|---|---|
| `apps/dashboard-web/app/components/CctvGateStream.tsx:117` | `${gateApi}/cctv/stream${suffix}` — 경로 조합 맞음 |
| `apps/dashboard-web/app/components/CctvQuadView.tsx:195` | 종전 경로도 `${aiApi}/cctv/stream${suffix}` — **같음** |
| `cctv-ai/edge/cctv_gate.py:180` | 젯슨 게이트에 `/cctv/stream3` **있음** (Flask, 기본 :8443) |
| `cctv-ai/main.py:709` | Cloud Run cctv-ai 에도 `/cctv/stream3` **있음** (FastAPI) |
| `cctv-ai/main.py:745` | **`/cctv/snapshot3` 도 있다** — `image/jpeg` 단발 |
| `apps/dashboard-web/app/ai-cctv/[...path]/route.ts:12` | 프록시 허용목록 `^cctv/(stream\|stats\|connection)\d*$` — **snapshot 은 403** |
| `cctv-ai/edge/cctv_gate.py:255-259` | 게이트는 **405 도 404 로 덮는다** |

**즉 양쪽 코드 모두 `/cctv/stream3` 이 있고, 404 를 낼 자리가 안 보인다.** 그게 이 의뢰의 출발점이다.

---

## Q1 (최우선) — 내 측정 설계 자체가 성립하는가?

`apps/dashboard-web/lib/cctv-ticket.ts:77` 주석: *"jti 는 게이트가 1회 소비한다 — 같은 티켓을 두 번 쓰지 못한다."*
`cctv-ai/edge/cctv_gate.py:131-132`: `_consume_jti` 실패 시 `"ticket already used"` **401**.

**내 측정 화면은 티켓 1장을 입력받아 주기마다 그걸 반복해서 보낸다.**

- 이 설계가 게이트 상대로 **2회차부터 무조건 401** 인 것이 맞나? `_consume_jti` 구현(`cctv_gate.py`)을 읽고 답해라.
- 맞다면 **주소를 고쳐도 측정이 안 된다.** 앱이 매 요청마다 새 티켓을 받아야 하고,
  그러려면 앱에 관제웹 로그인 세션이 있어야 한다. 앱에 그 세션이 있나?
  `app/vitalguard_field/lib/` 에서 세션·Authorization 을 다루는 곳을 찾아 **있다/없다**로 답해라.

## Q2 — 404 를 낼 수 있는 코드 경로가 정말 없나?

`cctv-ai/main.py` 전체에서 다음을 확인해라.

- FastAPI 앱에 `root_path`·`APIRouter(prefix=…)`·`app.mount(…)`·미들웨어가 있어 **경로가 한 겹 더 붙는가?**
- `mjpeg_ppe()`(`main.py:539`) 가 프레임 소스가 없을 때 예외를 던지거나 404 로 끝나는 흐름이 있나?
- `main.py` 가 **Cloud Run 에 올라가는 그 파일이 맞나?** `Dockerfile` 의 CMD/ENTRYPOINT 가 무엇을 실행하나?

## Q3 — 404 응답으로 주체를 가릴 수 있나

젯슨 게이트는 404 본문이 `{"error": "not found"}` 다(`cctv_gate.py:259`).
FastAPI 기본 404 는 `{"detail":"Not Found"}` 다. Cloud Run 이 서비스에 못 닿으면 또 다른 HTML 을 준다.

→ **측정 화면이 404 본문 앞부분을 화면에 찍게 하면 누가 404 를 줬는지 알 수 있나?** 그렇다면
`cctv_probe_screen.dart` 에서 **어디를 고치면 되는지 줄 번호로만** 알려줘라. (고치지는 마라.)

## Q4 — 측정 대상이 맞나

지시서 `TASK-cctv-probe.md` 는 "앱 V-01 은 MJPEG 연속 스트림이 아니라 **스냅샷 갱신**"이라고 썼다.

- `app/vitalguard_field/lib/` 에서 **V-01(CCTV 화면) 이 실제로 어떻게 영상을 받게 설계돼 있는지** 찾아라.
  코드가 아직 없으면 "없다"고 해라.
- 있다면 `/cctv/snapshot3`(단발 JPEG · MJPEG 파싱 불필요) 로 재는 것이 `/cctv/stream3` 첫 파트만
  끊어 읽는 것보다 **실제 앱 동작에 가까운가?** 근거를 들어 찬반을 말해라.
- 단 `snapshot3` 은 **게이트(cctv_gate.py)에는 없다.** 그 사실이 이 판단을 어떻게 바꾸나?

---

## 답변 형식

Q1~Q4 각각에 대해 **결론 한 줄 + 근거(파일:줄)**. 모르면 "모른다".
마지막에 **"다음에 무엇을 확인해야 404 가 풀리는가"를 우선순위 3개**로.

다 쓰면 `/Users/rlaxorhs77/Desktop/조달청 프로젝트/조달청_rlaxorhs77eng/tablet-app/astra-done.txt`
에 `ASK-cctv-404 완료` 한 줄을 덧붙여라(append, 덮어쓰지 마라).
