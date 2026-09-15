#!/usr/bin/env python3
# 대조표 뷰어 서버 — 정적 파일을 내주고, 브라우저의 선별 결과(제외 목록)를 POST 로 받아 파일로 남긴다.
import http.server, socketserver, json, os, datetime

ROOT = os.path.expanduser("~/Documents/조달청-공모전 관련자료/CAM03-COLLECT")
OUT = os.path.join(ROOT, "_view", "cuts.json")

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def do_POST(self):
        if self.path != "/_save":
            self.send_error(404)
            return
        try:
            n = int(self.headers.get("Content-Length", 0))
            data = json.loads(self.rfile.read(n).decode("utf-8"))
        except Exception as e:
            self.send_error(400, str(e))
            return
        data["_saved_at"] = datetime.datetime.now().isoformat(timespec="seconds")
        with open(OUT, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
        total = sum(len(v) for k, v in data.items() if isinstance(v, list))
        body = json.dumps({"ok": True, "total": total, "path": OUT}).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass

socketserver.TCPServer.allow_reuse_address = True
with socketserver.ThreadingTCPServer(("0.0.0.0", 8790), Handler) as srv:
    print("뷰어 8790 기동 · 저장 경로 " + OUT, flush=True)
    srv.serve_forever()
