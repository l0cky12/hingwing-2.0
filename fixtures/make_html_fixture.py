import importlib.util
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("make_math_fixture", HERE / "make_math_fixture.py")
math_fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(math_fixture)

REQUEST = "Mock up the save card for the settings page."
REPLY = """Here is the save card:

```html
<div style="font-family: system-ui, sans-serif; max-width: 320px; padding: 16px 18px; border: 1px solid #d0d7de; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,.08)">
  <h3 style="margin: 0 0 6px; font-size: 16px">Unsaved changes</h3>
  <p style="margin: 0 0 14px; color: #57606a; font-size: 14px">Save them before you leave this page.</p>
  <button onclick="alert(1)" style="padding: 8px 14px; border: 0; border-radius: 6px; background: #2563eb; color: white; font-size: 14px">Save changes</button>
  <a href="https://example.com/" style="margin-left: 10px; font-size: 14px">Discard</a>
</div>
<script>alert(2)</script>
```

The button keeps the page's blue."""

built = math_fixture.derive((HERE / "markdown.jsonl").read_text().splitlines(), REQUEST, REPLY)
target = HERE / "html.jsonl"
if sys.argv[1:] == ["--check"]:
    same = target.exists() and target.read_text() == built
    print("PASS: html.jsonl is what this script writes" if same else "FAIL: html.jsonl is stale; run this script without --check")
    sys.exit(0 if same else 1)
target.write_text(built)
