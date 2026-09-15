# 공개 게이트 — 관제웹이 서명한 티켓을 검증해 CAM-03 의 영상·통계만 바깥으로 내보낸다.
"""
왜 별도 프로세스인가
  gopro_ppe_edge.py(:8444) 는 /config·/mark·/reset·/snapshot?raw=1 을 인증 없이 연다.
  그 포트를 공개하면 비로그인자가 영상뿐 아니라 설정 변경까지 얻는다(적대검증 red-1 CRITICAL).
  그래서 바깥에 여는 것은 이 게이트 하나뿐이고, :8444 는 LAN·Tailscale 에만 남긴다.
  ★ 이 게이트는 :8444 를 읽기만 한다. 그 프로세스를 재기동하지 않으므로 GoPro 웨지 위험이 없다.

경로 — 이 넷 말고는 전부 404
  GET  /cctv/stream3       scope=read      MJPEG · 청크마다 만료를 다시 본다
  GET  /cctv/stats3        scope=read
  GET  /cctv/connection3   scope=read
  POST /cctv/connection3   scope=control   read 티켓으로는 403

티켓
  Authorization: Bearer <base64url(payload)>.<base64url(sig)>
  Ed25519 — 서명은 관제웹(개인키), 게이트는 공개키만 가진다.
  ⇒ 게이트가 통째로 털려도 control 티켓을 위조할 수 없다(적대검증 red-2 HIGH).
  ★ URL 쿼리로는 받지 않는다. URL 에 실린 티켓은 접근 로그·브라우저 기록·복사된 링크로 새는
    bearer 자격이고, 탈취자가 먼저 제시하면 통과한다(red-2 HIGH). 헤더로만 받는다.

기동
  GATE_PUBKEY=~/.cctv_gate_pubkey python3 cctv_gate.py
"""

import base64
import json
import os
import sqlite3
import threading
import time

import requests
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from flask import Flask, Response, jsonify, request

PORT = int(os.environ.get("GATE_PORT", "8443"))
UPSTREAM = os.environ.get("GATE_UPSTREAM", "http://127.0.0.1:8444").rstrip("/")
PUBKEY_PATH = os.path.expanduser(os.environ.get("GATE_PUBKEY", "~/.cctv_gate_pubkey"))
JTI_DB = os.path.expanduser(os.environ.get("GATE_JTI_DB", "~/.cctv_gate_jti.db"))
CAMERA = os.environ.get("GATE_CAMERA", "CAM-03")
SITE = os.environ.get("GATE_SITE", "SITE-01")
# nbf 에만 여유를 준다. exp 에는 주지 않는다 — 여유를 exp 에도 주면 실효 수명이 명목보다
# 길어져 "60초 티켓"이 90초가 된다(red-2 지적). 만료는 딱 끊는다.
SKEW = int(os.environ.get("GATE_SKEW", "30"))
MAX_STREAMS = int(os.environ.get("GATE_MAX_STREAMS", "8"))
RATE_PER_MIN = int(os.environ.get("GATE_RATE_PER_MIN", "120"))
# 응답을 읽어도 되는 화면의 주소. 쉼표로 여럿. 비면 CORS 헤더를 아예 안 붙인다.
ALLOW_ORIGINS = [o.strip() for o in os.environ.get("GATE_ALLOW_ORIGINS", "").split(",") if o.strip()]
TLS_CERT = os.environ.get("GATE_TLS_CERT", "")
TLS_KEY = os.environ.get("GATE_TLS_KEY", "")

app = Flask(__name__)
_lock = threading.Lock()
_streams = 0                      # 동시 스트림 수 — 회선과 젯슨 CPU 를 지키는 상한
_rate = {}                        # ip -> [분, 횟수]
_enabled = True                   # connection3 토글 · 게이트 로컬 상태(엣지를 건드리지 않는다)


def _load_pubkeys():
    """kid -> 공개키. 파일 한 줄이 `kid hex` 형식이다. 회전 중에는 두 줄을 둔다."""
    keys = {}
    with open(PUBKEY_PATH, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            kid, hexkey = line.split()
            keys[kid] = Ed25519PublicKey.from_public_bytes(bytes.fromhex(hexkey))
    if not keys:
        raise SystemExit(f"공개키가 비어 있다: {PUBKEY_PATH}")
    return keys


PUBKEYS = _load_pubkeys()


def _db():
    c = sqlite3.connect(JTI_DB, timeout=5)
    c.execute("CREATE TABLE IF NOT EXISTS jti (id TEXT PRIMARY KEY, exp INTEGER)")
    return c


def _consume_jti(jti, exp):
    """1회 소비. 이미 있으면 재사용이다.
    ★ 메모리가 아니라 파일에 둔다 — 게이트가 죽었다 살아나도 재사용이 막혀야 한다(red-2)."""
    c = _db()
    try:
        c.execute("DELETE FROM jti WHERE exp < ?", (int(time.time()) - 300,))   # 지난 것 청소
        c.execute("INSERT INTO jti (id, exp) VALUES (?, ?)", (jti, int(exp)))
        c.commit()
        return True
    except sqlite3.IntegrityError:
        return False
    finally:
        c.close()


def _b64d(s):
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _verify(scope_needed, consume=True):
    """티켓을 검증해 (payload, None) 또는 (None, 응답) 을 돌려준다."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None, (jsonify({"error": "ticket required"}), 401)
    try:
        body, sig = auth[7:].split(".", 1)
        raw = _b64d(body)
        p = json.loads(raw)
        key = PUBKEYS.get(p.get("kid", ""))
        if key is None:
            return None, (jsonify({"error": "unknown key"}), 401)
        key.verify(_b64d(sig), raw)
    except (ValueError, KeyError, InvalidSignature, json.JSONDecodeError):
        return None, (jsonify({"error": "bad ticket"}), 401)

    now = time.time()
    if p.get("nbf", 0) > now + SKEW:
        return None, (jsonify({"error": "not yet valid"}), 401)
    if p.get("exp", 0) <= now:                       # 여유 없음 — 의도된 것이다
        return None, (jsonify({"error": "expired"}), 401)
    if p.get("aud") != CAMERA:
        return None, (jsonify({"error": "wrong camera"}), 403)
    if p.get("sid") != SITE:
        return None, (jsonify({"error": "wrong site"}), 403)
    if p.get("scp") != scope_needed:
        return None, (jsonify({"error": f"scope {scope_needed} required"}), 403)
    if consume and not _consume_jti(p.get("jti", ""), p["exp"]):
        return None, (jsonify({"error": "ticket already used"}), 401)
    return p, None


def _rate_ok():
    """분당 요청 상한 — 공인 IP 로 직접 노출되므로 스캐너·재발급 폭주를 막는다."""
    ip = request.headers.get("X-Forwarded-For", request.remote_addr or "?").split(",")[0].strip()
    minute = int(time.time() // 60)
    with _lock:
        slot = _rate.get(ip)
        if slot is None or slot[0] != minute:
            _rate[ip] = [minute, 1]
            if len(_rate) > 2000:                    # 무한 증식 방지
                for k in [k for k, v in _rate.items() if v[0] < minute - 5]:
                    _rate.pop(k, None)
            return True
        slot[1] += 1
        return slot[1] <= RATE_PER_MIN


@app.before_request
def _guard():
    if not _rate_ok():
        return jsonify({"error": "too many requests"}), 429
    return None


@app.after_request
def _cors(resp):
    """관제웹이 다른 주소에서 열리므로 브라우저가 응답을 읽으려면 이 헤더가 필요하다.

    ★ CORS 는 인가가 아니다. 다른 오리진의 스크립트가 '응답을 읽는 것'만 제어할 뿐,
      요청이 도달하는 것도 서버 상태가 바뀌는 것도 막지 못한다(적대검증 red-1 HIGH).
      인가는 오직 티켓 검증이 한다. 이 헤더는 정상 화면이 값을 읽게 해 주는 배관일 뿐이다.
    ⚠ Authorization 헤더를 쓰면 브라우저가 먼저 OPTIONS(사전요청)를 보낸다.
      그 응답에 아래 헤더가 없으면 본 요청이 아예 나가지 않는다 — 화면은 그냥 비어 보인다.
    """
    origin = request.headers.get("Origin", "")
    if origin and origin in ALLOW_ORIGINS:
        resp.headers["Access-Control-Allow-Origin"] = origin
        resp.headers["Vary"] = "Origin"
        resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        resp.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
        resp.headers["Access-Control-Max-Age"] = "600"
        # 쿠키는 쓰지 않는다(표만 본다) → Allow-Credentials 를 켜지 않는다.
    return resp


@app.get("/cctv/stream3")
def stream3():
    global _streams
    p, err = _verify("read")
    if err:
        return err
    if not _enabled:
        return jsonify({"error": "disabled"}), 503
    with _lock:
        if _streams >= MAX_STREAMS:
            return jsonify({"error": "too many viewers"}), 503
        _streams += 1

    exp = p["exp"]

    def gen():
        global _streams
        try:
            with requests.get(f"{UPSTREAM}/stream", stream=True, timeout=(5, 30)) as r:
                for chunk in r.iter_content(chunk_size=16384):
                    # ★ 연결 시점 1회 검사로 끝내면 만료 뒤에도 무한 시청이 된다(red-2).
                    #   청크마다 다시 보고, 만료·중지면 즉시 끊는다.
                    if time.time() >= exp or not _enabled:
                        break
                    if chunk:
                        yield chunk
        except requests.RequestException:
            pass
        finally:
            with _lock:
                _streams -= 1

    return Response(gen(), mimetype="multipart/x-mixed-replace; boundary=frame",
                    headers={"Cache-Control": "no-store"})


@app.get("/cctv/stats3")
def stats3():
    _, err = _verify("read")
    if err:
        return err
    if not _enabled:
        return jsonify({"error": "disabled"}), 503
    try:
        h = requests.get(f"{UPSTREAM}/health", timeout=5).json()
    except (requests.RequestException, ValueError):
        return jsonify({"error": "upstream unreachable"}), 503
    s = h.get("stats") or {}
    # 관제웹이 읽는 이름 그대로만 내보낸다 — 그 밖의 진단 정보는 공개하지 않는다.
    out = {k: s.get(k, 0) for k in (
        "person_count", "violation_count", "compliance_rate",
        "hardhat_count", "no_hardhat_count")}
    # ★ 09-15 엔진 태그는 문자열이라 위 숫자 화이트리스트와 기본값이 다르다(0 이 아니라 "").
    #   관제웹이 하드코딩("YOLO26s v5") 대신 이 값을 쓴다 — 엔진을 바꿔도 화면이 따라온다.
    #   ⚠ 화이트리스트 원칙은 지킨다 — 이 한 키만 명시적으로 더한다(진단 정보는 여전히 비공개).
    out["engine"] = str(s.get("engine") or "")[:24]
    return jsonify(out)


@app.get("/cctv/connection3")
def connection_get():
    _, err = _verify("read")
    if err:
        return err
    return jsonify({"enabled": _enabled})


@app.post("/cctv/connection3")
def connection_set():
    global _enabled
    _, err = _verify("control")
    if err:
        return err
    body = request.get_json(silent=True) or {}
    if not isinstance(body.get("enabled"), bool):
        return jsonify({"error": "enabled must be boolean"}), 400
    _enabled = body["enabled"]
    return jsonify({"enabled": _enabled})


@app.errorhandler(404)
@app.errorhandler(405)
def _not_found(_e):
    """허용 목록 밖은 존재 자체를 알리지 않는다 — 405 도 404 로 덮는다."""
    return jsonify({"error": "not found"}), 404


if __name__ == "__main__":
    ctx = (TLS_CERT, TLS_KEY) if TLS_CERT and TLS_KEY else None
    print(f"[gate] :{PORT} {'HTTPS' if ctx else 'HTTP'} · upstream {UPSTREAM} · "
          f"{CAMERA}/{SITE} · kid {sorted(PUBKEYS)}", flush=True)
    app.run(host="0.0.0.0", port=PORT, threaded=True, ssl_context=ctx)
