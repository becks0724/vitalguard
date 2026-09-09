# 게이트 티켓 도구 — 키 쌍을 만들고 시험용 티켓에 서명한다. 관제웹 구현의 참조 규격이기도 하다.
"""
사용
  키 만들기   python3 gate_ticket.py genkey --kid v1 --out-private ~/.cctv_gate_privkey
              → 표준출력에 `v1 <공개키hex>` 한 줄. 이 줄을 젯슨의 ~/.cctv_gate_pubkey 에 둔다.
  서명        python3 gate_ticket.py sign --key ~/.cctv_gate_privkey --kid v1 \
                --scope read --camera CAM-03 --site SITE-01 --sub admin6861 --ttl 60

티켓 규격 (관제웹 TypeScript 도 이 형식을 그대로 만든다)
  <base64url(payload_json)>.<base64url(ed25519_sig(payload_json_bytes))>
  payload = {kid, aud(camera), sid(site), scp("read"|"control"), sub(user), nbf, exp, jti}
  전달은 Authorization: Bearer <ticket> 만 쓴다. URL 쿼리로 보내지 않는다.

⚠ 개인키는 저장소에 커밋하지 않는다. 실제 운영에서는 Cloud Run 시크릿에 둔다.
"""

import argparse
import base64
import json
import os
import stat
import time
import uuid

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


def _b64(b):
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def genkey(args):
    priv = Ed25519PrivateKey.generate()
    raw = priv.private_bytes(serialization.Encoding.Raw,
                             serialization.PrivateFormat.Raw,
                             serialization.NoEncryption())
    path = os.path.expanduser(args.out_private)
    with open(path, "wb") as f:
        f.write(raw)
    os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)          # 600
    pub = priv.public_key().public_bytes(serialization.Encoding.Raw,
                                         serialization.PublicFormat.Raw)
    print(f"{args.kid} {pub.hex()}")
    print(f"# 개인키 → {path} (600) · 이 줄 위쪽을 젯슨 ~/.cctv_gate_pubkey 에 넣는다",
          file=__import__("sys").stderr)


def sign(args):
    with open(os.path.expanduser(args.key), "rb") as f:
        priv = Ed25519PrivateKey.from_private_bytes(f.read())
    now = int(time.time())
    payload = {"kid": args.kid, "aud": args.camera, "sid": args.site,
               "scp": args.scope, "sub": args.sub,
               "nbf": now, "exp": now + args.ttl, "jti": str(uuid.uuid4())}
    raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
    print(f"{_b64(raw)}.{_b64(priv.sign(raw))}")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)

    g = sub.add_parser("genkey")
    g.add_argument("--kid", default="v1")
    g.add_argument("--out-private", default="~/.cctv_gate_privkey")
    g.set_defaults(func=genkey)

    s = sub.add_parser("sign")
    s.add_argument("--key", default="~/.cctv_gate_privkey")
    s.add_argument("--kid", default="v1")
    s.add_argument("--scope", choices=["read", "control"], default="read")
    s.add_argument("--camera", default="CAM-03")
    s.add_argument("--site", default="SITE-01")
    s.add_argument("--sub", default="admin6861")
    s.add_argument("--ttl", type=int, default=60)
    s.set_defaults(func=sign)

    a = ap.parse_args()
    a.func(a)


if __name__ == "__main__":
    main()
