import mimetypes
import json
import traceback
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from simulator import simulate_circuit


ROOT = Path(__file__).resolve().parent
HOST = "127.0.0.1"
PORT = 8765


class DevHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def do_POST(self):
        if self.path.rstrip("/") == "/api/simulate":
            self.handle_simulation_request()
            return
        self.send_error(404, "Not Found")

    def guess_type(self, path):
        ext = Path(path).suffix.lower()
        if ext == ".js":
          return "application/javascript; charset=utf-8"
        if ext == ".css":
          return "text/css; charset=utf-8"
        if ext == ".html":
          return "text/html; charset=utf-8"
        return mimetypes.guess_type(path)[0] or "application/octet-stream"

    def handle_simulation_request(self):
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_json({"ok": False, "error": "Invalid Content-Length"}, status=400)
            return

        try:
            raw_body = self.rfile.read(content_length) if content_length > 0 else b"{}"
            payload = json.loads(raw_body.decode("utf-8"))
        except json.JSONDecodeError:
            self.send_json({"ok": False, "error": "请求体不是合法 JSON。"}, status=400)
            return
        except UnicodeDecodeError:
            self.send_json({"ok": False, "error": "请求体编码必须为 UTF-8。"}, status=400)
            return

        try:
            result = simulate_circuit(payload)
            self.send_json(result, status=200)
        except Exception as exc:
            traceback.print_exc()
            self.send_json(
                {
                    "ok": False,
                    "error": f"Python 仿真器异常: {exc}",
                },
                status=500,
            )

    def send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), DevHandler)
    print(f"Serving on http://{HOST}:{PORT}")
    server.serve_forever()
