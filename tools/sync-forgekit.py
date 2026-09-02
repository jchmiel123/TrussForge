"""Refresh the vendored ForgeKit copy (web/vendor/forgekit).

    python tools/sync-forgekit.py

Thin shim: the real tool lives in the kit (ForgeKit/tools/vendor.py) so
every consumer syncs the same way. Bump ForgeKit/VERSION when its API
changes; the vendor tool stamps it alongside.
"""
import os
import runpy
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
VENDOR = os.path.normpath(os.path.join(ROOT, "..", "ForgeKit", "tools", "vendor.py"))

if not os.path.isfile(VENDOR):
    print("ForgeKit vendor tool not found at %s" % VENDOR)
    sys.exit(1)
sys.argv = [VENDOR, ROOT]
runpy.run_path(VENDOR, run_name="__main__")
