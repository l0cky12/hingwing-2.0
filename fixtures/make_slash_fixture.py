"""Write fixtures/slash.jsonl: fixtures/errand.jsonl with a `commands.catalog` answer in its header.

Run with Hermes's interpreter:  <hermes python> -I fixtures/make_slash_fixture.py

The catalog is built by ``tui_gateway.command_discovery.command_catalog``, the builder the canonical
gateway's ``commands.catalog`` handler calls (``gateway/session_discovery.py``).
"""
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

_version = subprocess.run(["hermes", "--version"], capture_output=True, text=True, check=True).stdout
_found = re.search(r"^Hermes Agent v(\S+)", _version, re.M), re.search(r"^Install directory:\s*(.+)$", _version, re.M)
if not all(_found):
    sys.exit(f"hermes --version printed no version or no 'Install directory:' line:\n{_version}")
HERMES_DIR = _found[1].group(1).strip()
sys.path.insert(0, HERMES_DIR)
import hermes_bootstrap  # noqa: E402,F401

HOME = "/tmp/hermes-slash-home"
HERE = Path(__file__).resolve().parent
SKILLS = {
    "release-notes": "Draft release notes from the change log",
    "code-review": "Review the current diff for bugs and unclear code",
}

shutil.rmtree(HOME, ignore_errors=True)
for name, description in SKILLS.items():
    folder = Path(HOME, "skills", name)
    folder.mkdir(parents=True)
    (folder / "SKILL.md").write_text(f"---\nname: {name}\ndescription: {description}\n---\nFollow the steps for {name}.\n")
os.environ["HERMES_HOME"] = HOME

from tui_gateway.command_discovery import command_catalog  # noqa: E402

catalog = command_catalog()
if sorted(catalog["skills"]) != sorted(f"/{name}" for name in SKILLS):
    sys.exit(f"expected the two skills, found {sorted(catalog['skills'])}")

lines = (HERE / "errand.jsonl").read_text().splitlines()
header = json.loads(lines[0])
header["catalog"] = catalog
out = HERE / "slash.jsonl"
out.write_text("\n".join([json.dumps(header, ensure_ascii=False), *lines[1:]]) + "\n")
print(f"wrote {out}: {len(catalog['pairs'])} catalog rows, {catalog['skill_count']} skills", file=sys.stderr)
