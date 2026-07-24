#!/usr/bin/env python3
# 낙상 ML 계획 문서(md) → 자가완결 HTML 한 장. 표준 라이브러리만 사용(마크다운 부분집합).
import html
import re
import sys
from pathlib import Path

DOCS = Path(__file__).resolve().parents[2] / "docs" / "fall-ml-relabel"
FILES = ["00-plan.md", "01-label-spec.md", "02-collection-protocol.md", "03-syncope-layer.md"]
OUT = DOCS / "index.html"


def inline(t):
    t = html.escape(t)
    t = re.sub(r"`([^`]+)`", r"<code>\1</code>", t)
    t = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", t)
    t = t.replace("[x]", "✅").replace("[ ]", "☐")
    return t


def render_table(rows):
    out = ['<table>']
    head = [c.strip() for c in rows[0].strip().strip("|").split("|")]
    out.append("<thead><tr>" + "".join(f"<th>{inline(c)}</th>" for c in head) + "</tr></thead>")
    out.append("<tbody>")
    for r in rows[2:]:
        cells = [c.strip() for c in r.strip().strip("|").split("|")]
        out.append("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in cells) + "</tr>")
    out.append("</tbody></table>")
    return "".join(out)


def md_to_html(md):
    lines = md.split("\n")
    out, i = [], 0
    in_code = False
    code_buf = []
    while i < len(lines):
        ln = lines[i]
        if ln.startswith("```"):
            if in_code:
                out.append("<pre><code>" + html.escape("\n".join(code_buf)) + "</code></pre>")
                code_buf, in_code = [], False
            else:
                in_code = True
            i += 1
            continue
        if in_code:
            code_buf.append(ln)
            i += 1
            continue
        # 표 감지: | ... | 다음 줄이 |---| 구분
        if ln.strip().startswith("|") and i + 1 < len(lines) and re.match(r"^\s*\|[\s:|-]+\|\s*$", lines[i + 1]):
            tbl = [ln]
            j = i + 1
            while j < len(lines) and lines[j].strip().startswith("|"):
                tbl.append(lines[j])
                j += 1
            out.append(render_table(tbl))
            i = j
            continue
        if ln.startswith("### "):
            out.append(f"<h3>{inline(ln[4:])}</h3>")
        elif ln.startswith("## "):
            out.append(f"<h2>{inline(ln[3:])}</h2>")
        elif ln.startswith("# "):
            out.append(f"<h1>{inline(ln[2:])}</h1>")
        elif ln.startswith("> "):
            out.append(f"<blockquote>{inline(ln[2:])}</blockquote>")
        elif re.match(r"^\s*[-*] ", ln):
            indent = len(ln) - len(ln.lstrip())
            item = re.sub(r"^\s*[-*] ", "", ln)
            out.append(("  " * (indent // 2)) + "<li>" + inline(item) + "</li>")
        elif re.match(r"^\d+\. ", ln.strip()):
            item = re.sub(r"^\s*\d+\. ", "", ln)
            out.append("<li>" + inline(item) + "</li>")
        elif ln.strip() == "---":
            out.append("<hr>")
        elif ln.strip() == "":
            out.append("")
        else:
            out.append(f"<p>{inline(ln)}</p>")
        i += 1
    # 연속 <li> 를 <ul> 로 감싸기
    wrapped, in_ul = [], False
    for el in out:
        is_li = el.strip().startswith("<li>")
        if is_li and not in_ul:
            wrapped.append("<ul>")
            in_ul = True
        elif not is_li and in_ul:
            wrapped.append("</ul>")
            in_ul = False
        wrapped.append(el)
    if in_ul:
        wrapped.append("</ul>")
    return "\n".join(wrapped)


sections = []
for f in FILES:
    p = DOCS / f
    if p.exists():
        sections.append(md_to_html(p.read_text(encoding="utf-8")))

body = '\n<hr class="docsep">\n'.join(sections)

CSS = """
:root{--bg:#fff;--fg:#1a1a1a;--muted:#666;--line:#e2e2e6;--accent:#2563eb;--code:#f4f4f6;--th:#f0f4ff;--warn:#b45309}
@media(prefers-color-scheme:dark){:root{--bg:#16171a;--fg:#e6e6e8;--muted:#9a9aa2;--line:#2c2d31;--accent:#6ea8ff;--code:#24252a;--th:#1e2430;--warn:#e0a94a}}
:root[data-theme=dark]{--bg:#16171a;--fg:#e6e6e8;--muted:#9a9aa2;--line:#2c2d31;--accent:#6ea8ff;--code:#24252a;--th:#1e2430;--warn:#e0a94a}
:root[data-theme=light]{--bg:#fff;--fg:#1a1a1a;--muted:#666;--line:#e2e2e6;--accent:#2563eb;--code:#f4f4f6;--th:#f0f4ff;--warn:#b45309}
*{box-sizing:border-box}
body{background:var(--bg);color:var(--fg);font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Segoe UI",sans-serif;line-height:1.6;max-width:920px;margin:0 auto;padding:32px 24px 80px}
h1{font-size:1.7rem;margin:1.4em 0 .5em;padding-bottom:.3em;border-bottom:2px solid var(--accent)}
h2{font-size:1.3rem;margin:1.5em 0 .5em;color:var(--accent)}
h3{font-size:1.08rem;margin:1.2em 0 .4em}
p{margin:.5em 0}
code{background:var(--code);padding:.12em .4em;border-radius:4px;font-size:.88em;font-family:"SF Mono",Menlo,monospace}
pre{background:var(--code);padding:14px 16px;border-radius:8px;overflow-x:auto}
pre code{background:none;padding:0}
blockquote{border-left:3px solid var(--accent);margin:.8em 0;padding:.3em 1em;color:var(--muted);background:var(--code);border-radius:0 6px 6px 0}
ul{margin:.5em 0;padding-left:1.4em}
li{margin:.25em 0}
hr{border:none;border-top:1px solid var(--line);margin:1.5em 0}
hr.docsep{border-top:3px double var(--accent);margin:3em 0}
table{border-collapse:collapse;width:100%;margin:1em 0;font-size:.92rem;display:block;overflow-x:auto}
th,td{border:1px solid var(--line);padding:8px 11px;text-align:left;vertical-align:top}
th{background:var(--th);font-weight:600;white-space:nowrap}
strong{font-weight:600}
"""

doc = (
    "<!doctype html><html lang='ko'><head><meta charset='utf-8'>"
    "<meta name='viewport' content='width=device-width,initial-scale=1'>"
    "<title>낙상 ML 재설계 계획</title><style>" + CSS + "</style></head><body>"
    + body + "</body></html>"
)
OUT.write_text(doc, encoding="utf-8")
print(f"wrote {OUT}")
