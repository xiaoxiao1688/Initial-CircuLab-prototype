from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import mimetypes


ROOT = Path(__file__).resolve().parent
HOST = "127.0.0.1"
PORT = 8765


class DevHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def guess_type(self, path):
        ext = Path(path).suffix.lower()
        if ext == ".js":
          return "application/javascript; charset=utf-8"
        if ext == ".css":
          return "text/css; charset=utf-8"
        if ext == ".html":
          return "text/html; charset=utf-8"
        return mimetypes.guess_type(path)[0] or "application/octet-stream"


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), DevHandler)
    print(f"Serving on http://{HOST}:{PORT}")
    server.serve_forever()
