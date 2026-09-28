# 게이트가 관제웹에 내보내는 키 화이트리스트를 지키는지 재는 시험 (flask 없이 돈다)
"""
왜 이 시험이 있나.

`/cctv/stats3` 의 화이트리스트는 **보안 경계**다 — 푸셔 health 에는 엔진 경로·자세 상세·
GoPro 내부 주소 같은 진단 정보가 섞여 있고, 그중 관제웹이 읽는 이름만 내보낸다.
키를 더할 일이 앞으로도 생기므로(09-15 engine · 09-16 worker/unknown), 더할 때마다
「샜는가」를 손으로 다시 확인하지 않도록 고정한다.

★ 화이트리스트를 여기 손으로 옮겨 적지 않는다 — 소스에서 뽑아 쓴다.
  옮겨 적으면 소스가 바뀌어도 시험이 옛 목록을 통과시켜 **거짓 초록**이 된다.

실행: python3 test_gate_whitelist.py
"""
import os
import re
import sys

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cctv_gate.py")


def load_whitelist():
    """cctv_gate.py 의 stats3 화이트리스트를 소스에서 그대로 뽑는다."""
    src = open(SRC, encoding="utf-8").read()
    m = re.search(r"out = \{k: s\.get\(k, 0\) for k in \((.*?)\)\}", src, re.S)
    assert m, "화이트리스트를 못 찾았다 — stats3 의 형태가 바뀌었는지 본다"
    keys = tuple(re.findall(r'"([a-z_]+)"', m.group(1)))
    assert keys, "화이트리스트가 비었다"
    return keys


KEYS = load_whitelist()


def gate(stats):
    """stats3 이 응답을 만드는 것과 같은 방식."""
    out = {k: stats.get(k, 0) for k in KEYS}
    out["engine"] = str(stats.get("engine") or "")[:24]
    return out


def main():
    ok = 0

    print("화이트리스트(소스에서 뽑음):", KEYS)

    print("\n① 구역 규칙 이전 푸셔 — 새 키가 없어도 안전하다")
    old = {"person_count": 1, "violation_count": 1, "compliance_rate": 0,
           "hardhat_count": 0, "no_hardhat_count": 1, "engine": "v7e"}
    a = gate(old)
    assert a["worker_count"] == 0, a
    assert a["unknown_count"] == 0, a
    assert a["engine"] == "v7e", a
    print("  ✓ worker_count·unknown_count 가 0 으로 채워진다")
    print("  ⚠ 배포 순서 주의 — 게이트를 먼저 올리고 푸셔를 나중에 올리면 그 사이 「작업자 0」이 간다")
    ok += 3

    print("\n② 구역 규칙이 들어간 푸셔 — 두 키가 그대로 나간다")
    new = dict(old, worker_count=2, unknown_count=1, violation_count=0, person_count=4)
    b = gate(new)
    assert b["worker_count"] == 2, b
    assert b["unknown_count"] == 1, b
    print("  ✓ worker 2 · unknown 1")
    ok += 2

    print("\n③ 통제군 — 진단 정보는 새지 않는다")
    leak = dict(new, fall_count=9, ZZZ_secret=123, pose_detail={"x": 1},
                gopro={"ip": "172.23.102.51"})
    c = gate(leak)
    for k in ("fall_count", "ZZZ_secret", "pose_detail", "gopro"):
        assert k not in c, f"{k} 가 샜다"
        ok += 1
    extra = set(c) - set(KEYS) - {"engine"}
    assert not extra, f"예상 밖 키 {extra}"
    print("  ✓ fall_count · ZZZ_secret · pose_detail · gopro 전부 차단")
    print("  ✓ 나간 키는 화이트리스트 + engine 뿐")
    ok += 1

    print("\n④ engine 은 문자열이라 기본값이 다르다(0 이 아니라 \"\")")
    d = gate({k: 0 for k in KEYS})
    assert d["engine"] == "", d
    assert isinstance(d["engine"], str), d
    print("  ✓ 빈 문자열")
    ok += 2

    print(f"\n✅ 전부 통과 ({ok}개 단언)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
