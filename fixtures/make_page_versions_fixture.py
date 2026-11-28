"""Write fixtures/page-versions.jsonl: one chat in which Hermes writes the same page twice.

Run with any Python 3:  python3 fixtures/make_page_versions_fixture.py
Check it:               python3 fixtures/make_page_versions_fixture.py --check

The first turn is fixtures/preview.jsonl's turn without its `desktop_preview` step, so no pane opens by itself. Its
`write_file` step writes fixtures/preview/index.html, titled "Demo page", to /tmp/hermes-proto-work/site/index.html.
The story then waits for the client's next `prompt.submit` and plays a second turn whose `write_file` step writes
fixtures/page-versions/index.html, titled "Demo page, updated", to the same path. A `stored` step after each turn
holds the rows a resume shows.

Unlike preview.jsonl this is not a recording of Hermes's gateway. Every frame is a copy of one of preview.jsonl's,
with the ids, `seq`, `at`, row ids and `persisted_turn` renumbered, and the admission counted on as Hermes does in a
recorded two-turn chat such as panels.jsonl (`sequence` 2, `execution_generation` 2, `revision` 2). The second step's
`inline_diff` is Hermes's rendering of `difflib.unified_diff` from the first page to the second
(agent/display.py `_diff_from_snapshot` and `_render_inline_unified_diff`), in the colours of the recorded diffs.

--check rebuilds the file and fails if it differs from page-versions.jsonl, if the first turn's frames up to its
`write_file` step and its first stored rows differ from preview.jsonl's, or if the colours differ from errand.jsonl's
recorded diff, which has removed and unchanged lines.
"""
import copy
import difflib
import hashlib
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SOURCE = [json.loads(line) for line in (HERE / "preview.jsonl").read_text().splitlines()]
TARGET = HERE / "page-versions.jsonl"
PAGE = "/tmp/hermes-proto-work/site/index.html"
FIRST_PAGE = (HERE / "preview" / "index.html").read_text()
SECOND_PAGE = (HERE / "page-versions" / "index.html").read_text()
FIRST_SAID = "I'll write the page first."
FIRST_REPLY = "The demo page is in the site folder."
SECOND_REQUEST = "Add this week's numbers to the page."
SECOND_SAID = "I'll update the page."
SECOND_REPLY = "The page now shows this week's numbers."
CHUNK = 24
GAP_MS = 34
ROW_TIME = SOURCE[0]["list"]["sessions"][0]["started_at"]

RESET = "\x1b[0m"
COLORS = {
    "file": "\x1b[38;2;218;165;32m",
    "hunk": "\x1b[38;2;139;134;130m",
    "minus": "\x1b[38;2;255;255;255;48;2;119;20;20m",
    "plus": "\x1b[38;2;255;255;255;48;2;19;87;20m",
    "dim": "\x1b[38;2;184;134;11m",
}
PREFIXES = (("@@", "hunk"), ("-", "minus"), ("+", "plus"), (" ", "dim"))


def frame(kind, **match):
    for row in SOURCE[1:]:
        params = row.get("push", {}).get("params", {})
        payload = params.get("payload", {})
        if params.get("type") == kind and all(payload.get(key) == value for key, value in match.items()):
            return row
    sys.exit(f"preview.jsonl has no {kind} frame with {match}")


SUBMIT = SOURCE[1]
QUEUED = frame("session.info", running=False, execution_generation=0)
START = frame("message.start")
STARTED = frame("session.info", running=True)
FIRST_STEP = frame("agent.step", iteration=1)
DELTA = next(row for row in SOURCE if row.get("push", {}).get("params", {}).get("payload", {}).get("text"))
GENERATING = frame("tool.generating", name="write_file")
NO_TEXT = frame("message.delta", text=None)
TOOL_START = frame("tool.start", tool_name="write_file")
TOOL_DONE = frame("tool.complete", tool_name="write_file")
SECOND_STEP = frame("agent.step", iteration=2)
COMPLETE = frame("message.complete")
IDLE = frame("session.info", running=False, execution_generation=1)


def inline_diff(before, after):
    diff = "".join(difflib.unified_diff(
        (before or "").splitlines(keepends=True), after.splitlines(keepends=True), fromfile=f"a/{PAGE}", tofile=f"b/{PAGE}",
    ))
    rendered = ["  ┊ review diff"]
    for line in diff.splitlines():
        if line.startswith("--- "):
            continue
        if line.startswith("+++ "):
            rendered.append(f"{COLORS['file']}a/{PAGE} → b/{PAGE}{RESET}")
            continue
        rendered.append(f"{COLORS[next(color for prefix, color in PREFIXES if line.startswith(prefix))]}{line}{RESET}")
    return "\n".join(rendered)


def fresh(name, size):
    return hashlib.sha256(f"page-versions {name}".encode()).hexdigest()[:size]


class Turn:
    def __init__(self, at, seq, ids, generation):
        self.steps, self.at, self.seq, self.ids, self.generation = [], at, seq, ids, generation

    def add(self, template, gap, edit=None):
        self.at += gap
        step = {"at": self.at, **{key: value for key, value in copy.deepcopy(template).items() if key != "at"}}
        if "push" in step:
            params = step["push"]["params"]
            self.seq += 1
            params["seq"] = self.seq
            if "admission_id" in params:
                params.update(admission_id=self.ids["admission"], execution_generation=self.generation)
        if edit is not None:
            edit(step)
        self.steps.append(step)
        return step

    def speak(self, text, offset, first_gap):
        for index in range(0, len(text), CHUNK):
            self.add(DELTA, first_gap if index == 0 else GAP_MS, lambda step: step["push"]["params"]["payload"].update(
                text=text[index:index + CHUNK], turn_id=self.ids["turn"], offset=offset + index))


def gap(earlier, later):
    return later["at"] - earlier["at"]


def play_turn(number, at, seq, ids, request, said, before, after, reply, kept):
    sequence = generation = revision = number
    turn = Turn(at, seq, ids, generation)

    def submitted(step):
        step["params"].update(text=request, input_id=ids["input"])
        step["reply"].update(admission_id=ids["admission"], sequence=sequence)

    def info(running_generation, pending_generation, revision_now):
        def edit(step):
            payload = step["push"]["params"]["payload"]
            payload.update(execution_generation=running_generation, revision=revision_now)
            for row in payload["pending"]:
                row.update(admission_id=ids["admission"], sequence=sequence, input_id=ids["input"], text=request, execution_generation=pending_generation)
        return edit

    turn.add(SUBMIT, 0, submitted)
    turn.add(QUEUED, gap(SUBMIT, QUEUED), info(generation - 1, None, revision - 1))
    turn.add(START, gap(QUEUED, START))
    turn.add(STARTED, gap(START, STARTED), info(generation, generation, revision - 1))
    turn.add(FIRST_STEP, gap(STARTED, FIRST_STEP))
    turn.speak(said, 0, gap(FIRST_STEP, DELTA))
    generating = turn.add(GENERATING, gap(SOURCE[SOURCE.index(GENERATING) - 1], GENERATING))
    turn.add(NO_TEXT, gap(GENERATING, NO_TEXT))

    args = {"path": PAGE, "content": after}
    result = json.dumps({
        "bytes_written": len(after.encode()), "dirs_created": before is None, "verified": True,
        "lint": {"status": "skipped", "message": "No linter for .html files"}, "resolved_path": PAGE, "files_modified": [PAGE],
    })
    tool = {"tool_id": ids["call"], "tool_call_id": ids["call"], "args": args}
    turn.add(TOOL_START, gap(NO_TEXT, TOOL_START), lambda step: step["push"]["params"]["payload"].update(tool))
    done = turn.add(TOOL_DONE, gap(TOOL_START, TOOL_DONE), lambda step: step["push"]["params"]["payload"].update(
        tool, result=result, inline_diff=inline_diff(before, after)))
    turn.add(SECOND_STEP, gap(TOOL_DONE, SECOND_STEP))
    turn.speak("\n\n" + reply, len(said), GAP_MS)
    spoken = turn.at

    row_ids = list(range(len(kept) + 1, len(kept) + 5))
    turn.add(COMPLETE, 4, lambda step: step["push"]["params"]["payload"].update(admission_id=ids["admission"], persisted_turn={
        **step["push"]["params"]["payload"]["persisted_turn"], "row_ids": row_ids, "user_row_id": row_ids[0],
        "user_row_ids": [row_ids[0]], "final_assistant_row_id": row_ids[-1], "submission_id": ids["input"],
    }))
    turn.add(IDLE, 4, info(generation, None, revision))

    stamp = lambda ms: round(ROW_TIME + ms / 1000, 6)
    rows = [
        {"role": "user", "text": request, "timestamp": stamp(generating["at"]), "row_id": row_ids[0]},
        {"role": "assistant", "text": said, "timestamp": round(stamp(generating["at"]) + 0.000001, 6), "row_id": row_ids[1]},
        {"role": "tool", "name": "write_file", "context": PAGE, "content": result, "tool_call_id": ids["call"], "timestamp": stamp(done["at"]), "args": args},
        {"role": "assistant", "text": reply, "timestamp": stamp(spoken), "row_id": row_ids[3]},
    ]
    turn.add({"stored": [*kept, *rows]}, 4)
    return turn


def build():
    first_ids = {
        "admission": SUBMIT["reply"]["admission_id"], "input": SUBMIT["params"]["input_id"],
        "turn": DELTA["push"]["params"]["payload"]["turn_id"], "call": TOOL_START["push"]["params"]["payload"]["tool_call_id"],
    }
    second_ids = {"admission": fresh("admission", 32), "input": f"input_{fresh('input', 16)}", "turn": fresh("turn", 32), "call": f"call_{fresh('call', 24)}"}
    request = SUBMIT["params"]["text"]
    first = play_turn(1, 0, 0, first_ids, request, FIRST_SAID, None, FIRST_PAGE, FIRST_REPLY, [])
    second = play_turn(2, first.at + 4, first.seq, second_ids, SECOND_REQUEST, SECOND_SAID, FIRST_PAGE, SECOND_PAGE, SECOND_REPLY, first.steps[-1]["stored"])
    steps = [SOURCE[0], *first.steps, *second.steps]
    return first, "".join(json.dumps(step, ensure_ascii=False) + "\n" for step in steps)


def check(first, built):
    problems = []
    if not TARGET.exists() or TARGET.read_text() != built:
        problems.append("page-versions.jsonl is stale; run this script without --check")
    through = SOURCE.index(SECOND_STEP)
    if first.steps[:through] != SOURCE[1:through + 1]:
        problems.append("the first turn's frames up to its write_file step are not preview.jsonl's")
    if first.steps[-1]["stored"][:3] != SOURCE[-1]["stored"][:3]:
        problems.append("the first turn's stored rows are not preview.jsonl's")
    drawn = set()
    for row in map(json.loads, (HERE / "errand.jsonl").read_text().splitlines()):
        for line in ((row.get("push", {}).get("params", {}).get("payload") or {}).get("inline_diff") or "").split("\n")[2:]:
            color, text = re.fullmatch(r"(\x1b\[[0-9;]*m)(.*)\x1b\[0m", line).groups()
            name = next(name for prefix, name in PREFIXES if text.startswith(prefix))
            drawn.add(name)
            if COLORS[name] != color:
                problems.append(f"errand.jsonl draws {text!r} in another colour")
    if drawn != {"hunk", "minus", "plus", "dim"}:
        problems.append(f"errand.jsonl's diffs draw only {sorted(drawn)}")
    for problem in problems:
        print(f"FAIL: {problem}")
    if not problems:
        print("PASS: page-versions.jsonl is what this script writes, its first turn is preview.jsonl's, and its colours are Hermes's")
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    first, built = build()
    if sys.argv[1:] == ["--check"]:
        check(first, built)
    TARGET.write_text(built)
    print(f"wrote {TARGET}")
