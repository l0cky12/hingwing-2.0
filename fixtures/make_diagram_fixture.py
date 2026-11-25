import importlib.util
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("make_math_fixture", HERE / "make_math_fixture.py")
math_fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(math_fixture)

REQUEST = "Sketch how a request moves through the relay."
REPLY = """Here is how a request moves through the relay:

```mermaid
flowchart LR
    A[Request] --> B{Signed in?}
    B -->|yes| C[Relay to bot]
    B -->|no| D[Ask to sign in]
    C --> E[Reply]
```

This one has a typo, so it cannot be drawn:

```mermaid
flowchart LR
    A[Start --> B
```

And one whose labels try to run code:

```mermaid
flowchart TD
    X["<script>alert(1)</script>"] --> Y["<img src=x onerror=alert(2)>"]
```

And one whose messages hold math and markup:

```mermaid
sequenceDiagram
    Alice->>Bob: $$x^2$$
    Bob->>Alice: <img src=x onerror=alert(3)>
```

That covers the relay from end to end."""

built = math_fixture.derive((HERE / "markdown.jsonl").read_text().splitlines(), REQUEST, REPLY)
target = HERE / "diagram.jsonl"
if sys.argv[1:] == ["--check"]:
    same = target.exists() and target.read_text() == built
    print("PASS: diagram.jsonl is what this script writes" if same else "FAIL: diagram.jsonl is stale; run this script without --check")
    sys.exit(0 if same else 1)
target.write_text(built)
