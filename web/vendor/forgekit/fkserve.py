"""ForgeKit serve - the static dev/deploy server every CodeLab web app
re-typed, plus the server-side named-document library.

Why not plain `python -m http.server`: it sends no Cache-Control, so
browsers heuristically cache ES modules and a redeploy can keep serving a
stale module graph for hours (StrataForge and TrussForge both learned it
the hard way). NoCacheHandler sends no-store on everything.

    # a consumer's tools/serve.py
    import os, sys
    sys.path.insert(0, os.path.join(ROOT, "web", "vendor", "forgekit"))
    from fkserve import DocLibrary, library_handler, run, main_args

    lib = DocLibrary(os.path.expanduser("~/.myapp-builds"), list_key="builds",
                     validate=lambda d: None if d.get("app") == "myapp" else "not a myapp document",
                     summarize=lambda d: {"nodes": len(d.get("nodes") or []), "savedAt": d.get("savedAt")})
    Handler = library_handler(lib, prefix="/api/builds")
    port, root, host = main_args(sys.argv, default_port=8329)
    run(Handler, port, host, root, banner="MyApp")

API (same origin as the app, so no CORS):
    GET    <prefix>          -> {"ok": true, "<list_key>": [{name, bytes, ...summary}], "dir": ...}
    GET    <prefix>/<name>   -> the document (JSON)
    PUT    <prefix>/<name>   -> store the body; {"ok": true, "name", "bytes", ...summary}
    DELETE <prefix>/<name>   -> {"ok": true, "deleted": name}

Names: 1..64 chars, letters / digits / space / . _ -, starting with a
letter or digit, never "." or "..". The name IS the file name
(<name>.json), one path component, so there is no traversal. Writes are
atomic (tempfile + os.replace) and the server is threaded, so two devices
saving the same name never publish a torn file. Keep the library dir
OUTSIDE the app tree so a deploy that swaps the tree never touches it.
"""

import json
import os
import re
import sys
import tempfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote

NAME_RE = re.compile(r"^(?!\.+$)[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$")
NAME_RULE = "1-64 chars: letters, digits, space . _ - ; starts with a letter or digit"


class NoCacheHandler(SimpleHTTPRequestHandler):
    """Static files with caching disabled. Quiet unless FK_SERVE_VERBOSE=1."""

    verbose_env = "FK_SERVE_VERBOSE"

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        SimpleHTTPRequestHandler.end_headers(self)

    def log_message(self, fmt, *args):
        if os.environ.get(self.verbose_env):
            SimpleHTTPRequestHandler.log_message(self, fmt, *args)


class LibraryError(Exception):
    def __init__(self, code, message):
        Exception.__init__(self, message)
        self.code = code


class DocLibrary:
    """Named JSON documents in a directory, one file per name."""

    def __init__(self, directory, list_key="docs", validate=None, summarize=None,
                 max_bytes=2_000_000, name_re=NAME_RE):
        self.directory = directory
        self.list_key = list_key
        self.validate = validate          # doc -> None | error string
        self.summarize = summarize        # doc -> dict merged into list rows / put reply
        self.max_bytes = max_bytes
        self.name_re = name_re

    def path(self, name):
        if not name or not self.name_re.match(name):
            return None
        return os.path.join(self.directory, name + ".json")

    def _path_or_raise(self, name):
        p = self.path(name)
        if not p:
            raise LibraryError(400, "bad name (%s)" % NAME_RULE)
        return p

    def _summary(self, doc):
        if not self.summarize:
            return {}
        try:
            return dict(self.summarize(doc) or {})
        except Exception:  # a summarizer must never take the API down
            return {}

    def list(self):
        out = []
        if not os.path.isdir(self.directory):
            return out
        for fn in sorted(os.listdir(self.directory), key=str.lower):
            if not fn.endswith(".json") or not self.name_re.match(fn[:-5]):
                continue
            p = os.path.join(self.directory, fn)
            row = {"name": fn[:-5], "bytes": os.path.getsize(p)}
            try:
                with open(p, "r", encoding="utf-8") as f:
                    doc = json.load(f)
                if not isinstance(doc, dict):
                    raise ValueError("not an object")
                row.update(self._summary(doc))
                if "savedAt" in doc and "savedAt" not in row:
                    row["savedAt"] = doc.get("savedAt")
            except (OSError, ValueError):
                row["corrupt"] = True
            out.append(row)
        return out

    def read(self, name):
        """Raw bytes of the stored document, or None if absent."""
        p = self._path_or_raise(name)
        if not os.path.isfile(p):
            return None
        with open(p, "rb") as f:
            return f.read()

    def write(self, name, raw):
        """Validate + store raw JSON bytes. Returns the reply dict."""
        p = self._path_or_raise(name)
        if raw is None or len(raw) > self.max_bytes:
            raise LibraryError(413, "document too large (max %d bytes)" % self.max_bytes)
        try:
            doc = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            raise LibraryError(400, "body must be JSON")
        if not isinstance(doc, dict):
            raise LibraryError(400, "document must be a JSON object")
        if self.validate:
            err = self.validate(doc)
            if err:
                raise LibraryError(400, str(err))
        doc["name"] = name
        text = json.dumps(doc, separators=(",", ":"))
        tmp = None
        try:
            os.makedirs(self.directory, exist_ok=True)
            fd, tmp = tempfile.mkstemp(dir=self.directory, suffix=".tmp")
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(text)
            os.replace(tmp, p)   # atomic: a crash never leaves a torn document
        except OSError as e:
            if tmp:
                try:
                    os.remove(tmp)
                except OSError:
                    pass
            raise LibraryError(500, "write failed: %s" % e)
        reply = {"ok": True, "name": name, "bytes": len(text)}
        reply.update(self._summary(doc))
        return reply

    def delete(self, name):
        p = self._path_or_raise(name)
        try:
            os.remove(p)
        except FileNotFoundError:
            raise LibraryError(404, "no document named \"%s\"" % name)
        except OSError as e:
            raise LibraryError(500, "delete failed: %s" % e)
        return {"ok": True, "deleted": name}


def library_handler(library, prefix="/api/docs", base=NoCacheHandler):
    """Build a request handler class: static files + the library API."""
    prefix = prefix.rstrip("/")

    class Handler(base):
        def _route(self):
            path = unquote(self.path.split("?", 1)[0])
            if path != prefix and not path.startswith(prefix + "/"):
                return False, None
            rest = path[len(prefix):]
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

        def _raw(self, body):
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _body(self):
            n = int(self.headers.get("Content-Length") or 0)
            if n > library.max_bytes:
                return None
            return self.rfile.read(n)

        def do_GET(self):
            is_api, name = self._route()
            if not is_api:
                return base.do_GET(self)
            try:
                if name is None:
                    return self._json(200, {"ok": True, library.list_key: library.list(), "dir": library.directory})
                body = library.read(name)
                if body is None:
                    return self._json(404, {"ok": False, "error": "no document named \"%s\"" % name})
                return self._raw(body)
            except LibraryError as e:
                return self._json(e.code, {"ok": False, "error": str(e)})

        def do_PUT(self):
            is_api, name = self._route()
            if not is_api or not name:
                return self._json(400, {"ok": False, "error": "bad name (%s)" % NAME_RULE})
            try:
                return self._json(200, library.write(name, self._body()))
            except LibraryError as e:
                return self._json(e.code, {"ok": False, "error": str(e)})

        def do_DELETE(self):
            is_api, name = self._route()
            if not is_api or not name:
                return self._json(400, {"ok": False, "error": "bad name (%s)" % NAME_RULE})
            try:
                return self._json(200, library.delete(name))
            except LibraryError as e:
                return self._json(e.code, {"ok": False, "error": str(e)})

    Handler.library = library
    return Handler


def main_args(argv, default_port, default_host="127.0.0.1"):
    """[port] [root] [host] -> (port, root, host). Host defaults to
    localhost so a dev server is never exposed by accident."""
    port = int(argv[1]) if len(argv) > 1 else default_port
    root = argv[2] if len(argv) > 2 else os.getcwd()
    host = argv[3] if len(argv) > 3 else default_host
    return port, root, host


def make_server(handler_cls, port, host="127.0.0.1", root=None):
    if root:
        os.chdir(root)
    return ThreadingHTTPServer((host, port), handler_cls)


def run(handler_cls, port, host="127.0.0.1", root=None, banner=""):
    srv = make_server(handler_cls, port, host, root)
    lib = getattr(handler_cls, "library", None)
    extra = ("  library in %s" % lib.directory) if lib else ""
    print("%s on http://%s:%d  serving %s%s" % (banner or "ForgeKit serve", host, srv.server_port, os.getcwd(), extra))
    sys.stdout.flush()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()


if __name__ == "__main__":
    # Plain no-cache static server: python fkserve.py [port] [root] [host]
    _port, _root, _host = main_args(sys.argv, 8000)
    run(NoCacheHandler, _port, _host, _root)
