"""Refresh the vendored ForgeKit copy: ../ForgeKit/forgekit/* -> web/vendor/forgekit/.

    python tools/sync-forgekit.py

Deploys are static trees (git archive + tar), so the app carries its own
copy of the kit - the same way cloud_llm.py is shared across projects.
Bump ForgeKit/VERSION when its API changes; this stamps it alongside.
"""
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.normpath(os.path.join(ROOT, "..", "ForgeKit"))
DST = os.path.join(ROOT, "web", "vendor", "forgekit")


def main():
    src_dir = os.path.join(SRC, "forgekit")
    if not os.path.isdir(src_dir):
        print("ForgeKit not found at %s" % SRC)
        return 1
    os.makedirs(DST, exist_ok=True)
    copied = []
    for fn in sorted(os.listdir(src_dir)):
        if fn.endswith((".js", ".css")):
            shutil.copyfile(os.path.join(src_dir, fn), os.path.join(DST, fn))
            copied.append(fn)
    ver = open(os.path.join(SRC, "VERSION"), encoding="utf-8").read().strip()
    with open(os.path.join(DST, "VERSION"), "w", encoding="utf-8", newline="\n") as f:
        f.write(ver + "\n")
    with open(os.path.join(DST, "README.md"), "w", encoding="utf-8", newline="\n") as f:
        f.write("Vendored copy of ForgeKit %s (D:\\CodeLab\\ForgeKit). Do not edit here -\n"
                "edit the kit and run `python tools/sync-forgekit.py`.\n" % ver)
    print("ForgeKit %s -> %s: %s" % (ver, os.path.relpath(DST, ROOT), ", ".join(copied)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
