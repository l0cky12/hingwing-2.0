import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
CHUNK = 24
GAP_MS = 34

REQUEST = "Remind me how to solve a quadratic, and what the workbook costs."
REPLY = r"""A quadratic $ax^2 + bx + c = 0$ with $a \neq 0$ has two roots:

$$
x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}
$$

The part under the root, \(b^2 - 4ac\), is the discriminant. When it is negative, the roots are complex.

The vertex sits halfway between them:

\[ x_v = -\frac{b}{2a} \]

The workbook costs $5 and the answer key costs $10. In Markdown, write `$x$` to show a formula.

A typo like $\sqrt{x$ shows as written."""


def derive(lines: list[str], request: str, reply: str) -> str:
    rows = [json.loads(line) for line in lines]
    old_request = rows[1]["params"]["text"]
    deltas = [at for at, row in enumerate(rows) if row.get("push", {}).get("params", {}).get("type") == "message.delta"]
    first, last = deltas[0], deltas[-1]
    if deltas != list(range(first, last + 1)):
        sys.exit("the reply's message.delta frames are not one run")

    def swap(value):
        if isinstance(value, dict):
            return {key: swap(item) for key, item in value.items()}
        if isinstance(value, list):
            return [swap(item) for item in value]
        return request if value == old_request else value

    rows = [swap(row) for row in rows]
    template = rows[first]
    start, seq = template["at"], template["push"]["params"]["seq"]
    streamed = []
    for index, offset in enumerate(range(0, len(reply), CHUNK)):
        frame = json.loads(json.dumps(template))
        frame["at"] = start + index * GAP_MS
        params = frame["push"]["params"]
        params["seq"] = seq + index
        params["payload"].update(text=reply[offset:offset + CHUNK], offset=offset)
        streamed.append(frame)

    shift = streamed[-1]["at"] - rows[last]["at"]
    later = rows[last + 1:]
    for index, row in enumerate(later):
        row["at"] += shift
        if "push" in row and "seq" in row["push"]["params"]:
            row["push"]["params"]["seq"] = seq + len(streamed) + index
        for stored in row.get("stored", []):
            stored["timestamp"] = round(stored["timestamp"] + shift / 1000, 6)
            if stored["role"] == "assistant":
                stored["text"] = reply
    out = [*rows[:first], *streamed, *later]
    return "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in out)


if __name__ == "__main__":
    source = (HERE / "markdown.jsonl").read_text()
    lines = source.splitlines()
    if sys.argv[1:] == ["--check"]:
        rows = [json.loads(line) for line in lines]
        own_reply = next(row for row in rows[-1]["stored"] if row["role"] == "assistant")["text"]
        same = derive(lines, rows[1]["params"]["text"], own_reply) == source
        print("PASS: markdown.jsonl derives from itself byte for byte" if same else "FAIL: markdown.jsonl does not derive from itself")
        sys.exit(0 if same else 1)
    (HERE / "math.jsonl").write_text(derive(lines, REQUEST, REPLY))
