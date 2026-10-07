#!/usr/bin/env python3
"""md → docx 변환 — 계획서 묶음 동기화용.

요구사항 6: `tab_plan.md` ↔ `tab_plan.docx`, `app_uIuX_plan.md` ↔ `app_uIuX_plan.docx`
는 **묶음**이고 하나를 고치면 다른 하나도 같이 고쳐야 한다.
사람이 둘을 따로 고치면 반드시 어긋나므로, **md 를 정본으로 두고 docx 를 생성**한다.

파이프라인 = md → (이 스크립트) → html → LibreOffice → docx
  · pandoc 없이 동작한다(설치 요청을 피하려고 표준 라이브러리만 쓴다).
  · 지원 문법은 이 문서들이 실제로 쓰는 것만이다 — 제목·표·목록·코드블록·인용·강조·링크·수평선.

사용:
    python3 tools/md2docx.py "Lenova idea tap 12.7/tab_plan.md"
    python3 tools/md2docx.py --all          # 이 폴더의 *_plan.md 전부
"""
import html as _html
import os
import re
import subprocess
import sys
from pathlib import Path

import contextlib
import fcntl
import tempfile
import time

RUNTIME_SOFFICE = (
    Path.home()
    / ".cache/codex-runtimes/codex-primary-runtime/dependencies/bin/override/soffice"
)
SOFFICE = str(
    RUNTIME_SOFFICE
    if RUNTIME_SOFFICE.exists()
    else Path("/Applications/LibreOffice.app/Contents/MacOS/soffice")
)
FONTCONFIG = Path(__file__).resolve().parent / "render-fontconfig.xml"

CSS = """
@page { size: A4; margin: 20mm 18mm; }
body { font-family: "Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",sans-serif;
       font-size: 10.5pt; line-height: 1.65; color: #1A1A1A; }
h1 { font-size: 20pt; margin: 0 0 6pt; border-bottom: 2px solid #0D74CE; padding-bottom: 5pt; }
h2 { font-size: 14pt; margin: 18pt 0 6pt; color: #0D74CE; }
h3 { font-size: 12pt; margin: 13pt 0 4pt; }
h4 { font-size: 11pt; margin: 10pt 0 3pt; color: #444; }
p  { margin: 0 0 6pt; }
ul, ol { margin: 0 0 8pt 0; padding-left: 18pt; }
li { margin-bottom: 2pt; }
table { border-collapse: collapse; width: 100%; margin: 6pt 0 10pt; font-size: 9.5pt; }
th, td { border: 0.5pt solid #C8CCD2; padding: 4pt 6pt; text-align: left; vertical-align: top; }
th { background: #EEF3F8; font-weight: bold; }
code { font-family: "SF Mono",Menlo,Consolas,monospace; font-size: 9pt; background: #F2F3F5; padding: 0 2pt; }
pre  { font-family: "SF Mono",Menlo,Consolas,monospace; font-size: 8.5pt; background: #F7F8FA;
       border: 0.5pt solid #DDE1E6; padding: 6pt 8pt; white-space: pre-wrap; margin: 5pt 0 9pt; }
blockquote { margin: 5pt 0 9pt; padding: 5pt 10pt; border-left: 3pt solid #0D74CE; background: #F6F9FC; }
hr { border: 0; border-top: 0.5pt solid #C8CCD2; margin: 12pt 0; }
"""


def inline(t: str) -> str:
    """강조·코드·링크만 처리한다. 이스케이프가 먼저다."""
    t = _html.escape(t)
    t = re.sub(r"&lt;br\s*/?&gt;", "<br>", t, flags=re.IGNORECASE)
    t = re.sub(r"`([^`]+)`", r"<code>\1</code>", t)
    t = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", t)
    t = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<i>\1</i>", t)
    t = re.sub(r"~~([^~]+)~~", r"<s>\1</s>", t)
    t = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', t)
    return t


def md_to_html(md: str, title: str) -> str:
    out, lines, i = [], md.split("\n"), 0
    list_stack = []          # 열린 목록 태그

    def close_lists(to=0):
        while len(list_stack) > to:
            out.append(f"</{list_stack.pop()}>")

    while i < len(lines):
        ln = lines[i]

        # 코드블록
        if ln.startswith("```"):
            close_lists()
            i += 1
            buf = []
            while i < len(lines) and not lines[i].startswith("```"):
                buf.append(_html.escape(lines[i]))
                i += 1
            i += 1
            out.append("<pre>" + "\n".join(buf) + "</pre>")
            continue

        # 표 — 헤더 + 구분행이 이어질 때만
        if ln.strip().startswith("|") and i + 1 < len(lines) and re.match(r"^\s*\|[\s:|-]+\|\s*$", lines[i + 1]):
            close_lists()
            def cells(row):
                return [c.strip() for c in row.strip().strip("|").split("|")]
            head = cells(ln)
            i += 2
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append(cells(lines[i])); i += 1
            out.append("<table><thead><tr>"
                       + "".join(f"<th>{inline(c)}</th>" for c in head)
                       + "</tr></thead><tbody>")
            for r in rows:
                r += [""] * (len(head) - len(r))
                out.append("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in r[:len(head)]) + "</tr>")
            out.append("</tbody></table>")
            continue

        # 제목
        m = re.match(r"^(#{1,4})\s+(.*)$", ln)
        if m:
            close_lists()
            lv = len(m.group(1))
            out.append(f"<h{lv}>{inline(m.group(2))}</h{lv}>")
            i += 1
            continue

        # 수평선
        if re.match(r"^\s*---+\s*$", ln):
            close_lists(); out.append("<hr>"); i += 1; continue

        # 인용 (연속 줄 묶음)
        if ln.lstrip().startswith(">"):
            close_lists()
            buf = []
            while i < len(lines) and lines[i].lstrip().startswith(">"):
                buf.append(lines[i].lstrip()[1:].strip()); i += 1
            out.append("<blockquote>" + "<br>".join(inline(b) for b in buf if b != "") + "</blockquote>")
            continue

        # 목록 (들여쓰기 2칸 = 한 단계)
        m = re.match(r"^(\s*)([-*+]|\d+\.)\s+(.*)$", ln)
        if m:
            depth = len(m.group(1)) // 2 + 1
            tag = "ol" if m.group(2)[0].isdigit() else "ul"
            while len(list_stack) > depth:
                out.append(f"</{list_stack.pop()}>")
            while len(list_stack) < depth:
                out.append(f"<{tag}>"); list_stack.append(tag)
            out.append(f"<li>{inline(m.group(3))}</li>")
            i += 1
            continue

        # 빈 줄
        if ln.strip() == "":
            close_lists(); i += 1; continue

        # 문단
        close_lists()
        out.append(f"<p>{inline(ln)}</p>")
        i += 1

    close_lists()
    return (f'<!doctype html><html lang="ko"><head><meta charset="utf-8">'
            f"<title>{_html.escape(title)}</title><style>{CSS}</style></head>"
            f"<body>{''.join(out)}</body></html>")


# LibreOffice 는 **한 프로필을 두 인스턴스가 동시에 쓰지 못한다.**
# 두 개가 겹치면 macOS 앱 등록 단계에서 죽는다 — 실제로 겪었다(2026-09-12, 4연속 크래시):
#   HIServices `_RegisterApplication` → `abort` (SIGABRT), byProc=soffice
#   클로드와 코덱스가 각자 md2docx 를 돌리다 겹쳤다.
# 그래서 ⓐ 파일 락으로 **직렬화**하고 ⓑ 이 도구 **전용 프로필**을 따로 쓴다.
# ⚠ 락·프로필을 `tempfile.gettempdir()` 에 두면 **공유되지 않는다.**
#   macOS 는 프로세스마다 다른 임시 폴더를 준다(내 값은 /var/folders/... , 샌드박스는 또 다르다).
#   실제로 이것 때문에 2차 크래시가 났다 — 두 실행이 **서로 다른 락 파일**을 잡았다.
#   그래서 락은 **이 스크립트 옆(고정 경로)** 에 둔다. 누가 돌리든 같은 파일을 본다.
# 락은 **작업공간 고정 경로**에 둔다 — 누가 돌리든 같은 파일을 봐야 직렬화가 된다.
#   (`tempfile.gettempdir()` 은 프로세스마다 달라서 공유되지 않는다. 이것 때문에 2차 크래시가 났다.)
LOCK = Path(__file__).resolve().parent / ".md2docx.lock"

# ⚠ 프로필은 **반드시 ASCII 경로**여야 한다.
#   `-env:UserInstallation` 은 `file://` URL 인데 **한글·공백이 인코딩되지 않아 깨진다.**
#   작업공간 경로(`…/조달청 프로젝트/…/Lenova idea tap 12.7/tools/`)를 줬더니
#   `RuntimeException` 으로 죽었다(rc=-6). 샌드박스와 일반 실행이 함께 쓸 수 있는
#   고정 ASCII 경로를 사용한다.
PROFILE = Path("/private/tmp/vitalguard-md2docx-lo-profile")


@contextlib.contextmanager
def _soffice_lock(timeout: float = 180.0):
    """변환을 한 번에 하나만 돌게 한다. 기다리다 안 되면 이유를 말하고 죽는다."""
    LOCK.touch(exist_ok=True)
    fh = LOCK.open("r+")
    start = time.monotonic()
    while True:
        try:
            fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
            break
        except BlockingIOError:
            if time.monotonic() - start > timeout:
                fh.close()
                raise SystemExit(
                    f"다른 변환이 {timeout:.0f}초 넘게 잡고 있다: {LOCK}\n"
                    "  실행 중인 md2docx 를 확인하라. 남은 좀비면:\n"
                    "    pkill -f 'MacOS/soffice'")
            time.sleep(0.4)
    try:
        yield
    finally:
        fcntl.flock(fh, fcntl.LOCK_UN)
        fh.close()


def _await_soffice_exit(timeout: float = 30.0) -> None:
    """남은 soffice 프로세스가 전부 사라질 때까지 기다린다."""
    start = time.monotonic()
    while time.monotonic() - start < timeout:
        alive = subprocess.run(["pgrep", "-f", "MacOS/soffice"],
                               capture_output=True, text=True).stdout.strip()
        if not alive:
            return
        time.sleep(0.3)
    # 시간이 지나도 남아 있으면 알리기만 한다 — 남의 LibreOffice 를 죽이지 않는다.
    print("  ⚠ soffice 가 아직 살아 있다. 다음 변환이 충돌할 수 있다.", file=sys.stderr)


def convert(md_path: Path) -> Path:
    if not md_path.exists():
        raise SystemExit(f"없는 파일: {md_path}")
    html_path = md_path.with_suffix(".html")
    docx_path = md_path.with_suffix(".docx")

    html_path.write_text(md_to_html(md_path.read_text(encoding="utf-8"), md_path.stem), encoding="utf-8")
    # ⚠ 변환 전 시각을 기록해 둔다. 아래에서 **갱신 여부**를 확인하는 데 쓴다.
    before = docx_path.stat().st_mtime if docx_path.exists() else 0.0
    with _soffice_lock():
        convert_env = os.environ.copy()
        if FONTCONFIG.exists():
            convert_env["FONTCONFIG_FILE"] = str(FONTCONFIG)
        r = subprocess.run(
            [SOFFICE,
             f"-env:UserInstallation=file://{PROFILE}",  # 사용자가 연 LibreOffice 와 프로필을 나눈다
             "--headless", "--convert-to", "docx:MS Word 2007 XML",
             "--infilter=HTML (StarWriter)", "--outdir", str(md_path.parent), str(html_path)],
            capture_output=True, text=True, env=convert_env)
        # ⚠ `soffice` 는 래퍼라 **자식을 남기고 먼저 반환한다.**
        #   락을 놓기 전에 실제로 사라질 때까지 기다린다. 안 그러면 다음 변환이 겹쳐 죽는다.
        _await_soffice_exit()
    html_path.unlink(missing_ok=True)          # 중간 산출물은 남기지 않는다
    # ★ **"파일이 있다" 를 성공으로 보지 않는다.**
    #   soffice 가 죽어도 **이전 docx 가 남아 있으면** 성공으로 오인한다 — 실제로 겪었다.
    #   md 는 15:03 인데 docx 는 14:31 인 채로 "✓ 변환 성공" 을 찍었다.
    if not docx_path.exists() or docx_path.stat().st_mtime <= before:
        raise SystemExit(
            f"변환 실패(파일이 갱신되지 않았다): {docx_path.name}\n"
            f"  rc={r.returncode}\n  stdout={r.stdout.strip()[:400]}\n  stderr={r.stderr.strip()[:400]}")
    return docx_path


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        raise SystemExit(__doc__)
    if args[0] == "--all":
        base = Path(__file__).resolve().parent.parent
        targets = sorted(base.glob("*_plan.md")) + sorted(base.glob("*_plan.md"))
        targets = sorted(set(targets))
    else:
        targets = [Path(a).expanduser().resolve() for a in args]
    for t in targets:
        d = convert(t)
        print(f"✓ {t.name} → {d.name}  ({d.stat().st_size:,} bytes)")
