"""Smoke test for tools/serve.py: starts it on a free port with a temp
library dir and exercises the build API. Run: python tests/serve-smoke.py
(exit 0 = pass). Pure stdlib."""
import json, os, sys, tempfile, threading, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "tools"))
tmp = tempfile.mkdtemp(prefix="tf-builds-")
os.environ["TF_BUILDS_DIR"] = tmp
import serve  # noqa: E402
serve.BUILDS_DIR = tmp

from http.server import ThreadingHTTPServer  # noqa: E402
os.chdir(ROOT)
httpd = ThreadingHTTPServer(("127.0.0.1", 0), serve.Handler)
port = httpd.server_address[1]
threading.Thread(target=httpd.serve_forever, daemon=True).start()
BASE = "http://127.0.0.1:%d" % port

fails = 0
def check(name, cond, note=""):
    global fails
    print(("PASS  " if cond else "FAIL  ") + name + ("  " + note if note else ""))
    if not cond: fails += 1

def req(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method,
                               headers={"Content-Type": "application/json"} if data else {})
    try:
        with urllib.request.urlopen(r) as resp:
            return resp.status, json.loads(resp.read().decode()), dict(resp.headers)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}"), dict(e.headers)

doc = {"app": "trussforge", "version": 1, "nodes": [{"id": 1, "x": 0, "y": 0}], "members": [], "savedAt": "2026-09-02T00:00:00Z"}

st, j, _ = req("GET", "/api/builds")
check("S1 empty library lists nothing", st == 200 and j["ok"] and j["builds"] == [])
st, j, _ = req("PUT", "/api/builds/My%20Walker", doc)
check("S2 PUT stores a build", st == 200 and j["ok"] and j["nodes"] == 1, str(j))
check("S3 file landed in the library dir", os.path.isfile(os.path.join(tmp, "My Walker.json")))
st, j, _ = req("GET", "/api/builds")
check("S4 list shows it with counts", st == 200 and j["builds"][0]["name"] == "My Walker" and j["builds"][0]["nodes"] == 1, str(j))
st, j, h = req("GET", "/api/builds/My%20Walker")
check("S5 GET returns the document with its name stamped", st == 200 and j["app"] == "trussforge" and j["name"] == "My Walker")
check("S6 no-store cache headers", "no-store" in h.get("Cache-Control", ""))
st, j, _ = req("PUT", "/api/builds/..%2Fescape", doc)
check("S7 traversal name rejected", st == 400, str(st))
st, j, _ = req("PUT", "/api/builds/bad", {"app": "other"})
check("S8 non-trussforge body rejected", st == 400)
st, j, _ = req("GET", "/api/builds/nope")
check("S9 missing build is 404", st == 404)
st, j, _ = req("DELETE", "/api/builds/My%20Walker")
check("S10 DELETE removes it", st == 200 and j["ok"])
st, j, _ = req("GET", "/api/builds")
check("S11 library empty again", j["builds"] == [])
with urllib.request.urlopen(BASE + "/web/index.html") as resp:
    check("S12 static files still served (no-store)", resp.status == 200 and "no-store" in resp.headers.get("Cache-Control", ""))
httpd.shutdown()
print("\n%s" % ("ALL PASS" if not fails else "%d FAILED" % fails))
sys.exit(1 if fails else 0)
