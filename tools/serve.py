"""TrussForge server: static files + the build library API.

    python tools/serve.py [port] [root] [host]
    python tools/serve.py 8329 D:\\CodeLab\\TrussForge 127.0.0.1   # dev
    python tools/serve.py 8337 ~/vulcan/repos/TrussForge 0.0.0.0    # Vulcan

The server itself is ForgeKit's fkserve (no-store static files + an
atomic named-document library); this file only says what a TrussForge
build looks like and where the library lives. Builds live OUTSIDE the
app tree (default ~/.trussforge-builds, env TF_BUILDS_DIR) so a deploy
that swaps the whole repo directory never touches them.

API: GET/PUT/DELETE /api/builds[/<name>] - see fkserve.py.
"""

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "web", "vendor", "forgekit"))
from fkserve import DocLibrary, library_handler, main_args, run, NAME_RE  # noqa: E402

DEFAULT_PORT = 8329
BUILDS_DIR = os.environ.get("TF_BUILDS_DIR") or os.path.expanduser("~/.trussforge-builds")


def validate(doc):
    if doc.get("app") != "trussforge" or not isinstance(doc.get("nodes"), list):
        return "not a trussforge build document"
    return None


def summarize(doc):
    return {"nodes": len(doc.get("nodes") or []), "members": len(doc.get("members") or []),
            "savedAt": doc.get("savedAt")}


library = DocLibrary(BUILDS_DIR, list_key="builds", validate=validate, summarize=summarize)
Handler = library_handler(library, "/api/builds")


def main():
    port, root, host = main_args(sys.argv, DEFAULT_PORT)
    run(Handler, port, host, root, banner="TrussForge server")


if __name__ == "__main__":
    main()
