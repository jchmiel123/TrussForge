"""TrussForge server: static files + the build library API.

    python tools/serve.py [port] [root] [host]
    python tools/serve.py 8329 D:\\CodeLab\\TrussForge 127.0.0.1   # dev
    python tools/serve.py 8337 ~/vulcan/repos/TrussForge 0.0.0.0    # Vulcan

Why not plain `python -m http.server`:
  1. It sends no Cache-Control, so browsers heuristically cache ES modules
     and a redeploy can keep serving a stale module graph for hours. This
     server sends no-store on everything (StrataForge learned this the
     hard way).
  2. Builds are saved ON THE SERVER so the same library shows up on every
     device pointed at it (phone, desktop). The library lives OUTSIDE the
     app tree (default ~/.trussforge-builds) so a deploy that swaps the
     whole repo directory never touches it.

API (same origin as the app, so no CORS needed):
    GET    /api/builds          -> {"ok": true, "builds": [{name, bytes, nodes, members, savedAt}, ...]}
    GET    /api/builds/<name>   -> the build document (JSON)
    PUT    /api/builds/<name>   -> store the body (must be a trussforge document)
    DELETE /api/builds/<name>   -> remove

Names: 1..64 chars, letters / digits / space / . _ -, starting with a
letter or digit. The name IS the file name (<name>.json), one path
component, so there is no traversal. Writes are atomic (tempfile +
os.replace) and this server is threaded, so two devices saving the same
name never publish a torn file.
"""

import json
import os
import re
import sys
import tempfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote

DEFAULT_PORT = 8329
BUILDS_DIR = os.environ.get("TF_BUILDS_DIR") or os.path.expanduser("~/.trussforge-builds")
NAME_RE = re.compile(r"^(?!\.+$)[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$")
MAX_BYTES = 2_000_000
API_PREFIX = "/api/builds"


def build_path(name):
    if not name or not NAME_RE.match(name):
        return None
    return os.path.join(BUILDS_DIR, name + ".json")


def list_builds():
    out = []
    if not os.path.isdir(BUILDS_DIR):
        return out
    for fn in sorted(os.listdir(BUILDS_DIR), key=str.lower):
        if not fn.endswith(".json"):
            continue
        p = os.path.join(BUILDS_DIR, fn)
        row = {"name": fn[:-5], "bytes": os.path.getsize(p)}
        try:
            with open(p, "r", encoding="utf-8") as f:
                d = json.load(f)
            row["nodes"] = len(d.get("nodes") or [])
            row["members"] = len(d.get("members") or [])
            row["savedAt"] = d.get("savedAt")
        except (OSError, ValueError):
            row["corrupt"] = True
        out.append(row)
    return out


class Handler(SimpleHTTPRequestHandler):
    # ---- helpers ---------------------------------------------------------
    def _route(self):
        """Return (is_api, name_or_None)."""
        path = unquote(self.path.split("?", 1)[0])
        if not path.startswith(API_PREFIX):
            return False, None
        rest = path[len(API_PREFIX):]
        if rest in ("", "/"):
            return True, None
        return True, rest.lstrip("/")

    def _json(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_BYTES:
            return None
        return self.rfile.read(n)

    # ---- verbs -------------------------------------------------------------
    def do_GET(self):
        is_api, name = self._route()
        if not is_api:
            return SimpleHTTPRequestHandler.do_GET(self)
        if name is None:
            return self._json(200, {"ok": True, "builds": list_builds(), "dir": BUILDS_DIR})
        p = build_path(name)
        if not p:
            return self._json(400, {"ok": False, "error": "bad build name"})
        if not os.path.isfile(p):
            return self._json(404, {"ok": False, "error": "no build named \"%s\"" % name})
        with open(p, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_PUT(self):
        is_api, name = self._route()
        p = build_path(name) if (is_api and name) else None
        if not p:
            return self._json(400, {"ok": False, "error": "bad build name (1-64 chars: letters, digits, space . _ -)"})
        raw = self._read_body()
        if raw is None:
            return self._json(413, {"ok": False, "error": "build too large"})
        try:
            doc = json.loads(raw.decode("utf-8"))
        except ValueError:
            return self._json(400, {"ok": False, "error": "body must be JSON"})
        if not isinstance(doc, dict) or doc.get("app") != "trussforge" or not isinstance(doc.get("nodes"), list):
            return self._json(400, {"ok": False, "error": "not a trussforge build document"})
        doc["name"] = name
        text = json.dumps(doc, separators=(",", ":"))
        tmp = None
        try:
            os.makedirs(BUILDS_DIR, exist_ok=True)
            fd, tmp = tempfile.mkstemp(dir=BUILDS_DIR, suffix=".tmp")
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(text)
            os.replace(tmp, p)  # atomic: a crash never leaves a torn build
        except OSError as e:
            if tmp:
                try:
                    os.remove(tmp)
                except OSError:
                    pass
            return self._json(500, {"ok": False, "error": "write failed: %s" % e})
        return self._json(200, {"ok": True, "name": name, "bytes": len(text),
                                "nodes": len(doc["nodes"]), "members": len(doc.get("members") or [])})

    def do_DELETE(self):
        is_api, name = self._route()
        p = build_path(name) if (is_api and name) else None
        if not p:
            return self._json(400, {"ok": False, "error": "bad build name"})
        try:
            os.remove(p)
        except FileNotFoundError:
            return self._json(404, {"ok": False, "error": "no build named \"%s\"" % name})
        except OSError as e:
            return self._json(500, {"ok": False, "error": "delete failed: %s" % e})
        return self._json(200, {"ok": True, "deleted": name})

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        SimpleHTTPRequestHandler.end_headers(self)

    def log_message(self, fmt, *args):
        if os.environ.get("TF_SERVE_VERBOSE"):
            SimpleHTTPRequestHandler.log_message(self, fmt, *args)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PORT
    root = sys.argv[2] if len(sys.argv) > 2 else os.getcwd()
    host = sys.argv[3] if len(sys.argv) > 3 else "127.0.0.1"
    os.chdir(root)
    print("TrussForge server on http://%s:%d  serving %s  builds in %s" % (host, port, os.getcwd(), BUILDS_DIR))
    sys.stdout.flush()
    ThreadingHTTPServer((host, port), Handler).serve_forever()


if __name__ == "__main__":
    main()
