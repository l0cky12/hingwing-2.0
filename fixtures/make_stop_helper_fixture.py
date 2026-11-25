"""Write fixtures/stop-helper.jsonl, fixtures/stop-helper-gone.jsonl and fixtures/delegate-reopened.jsonl from
fixtures/delegate.jsonl.

Run with any Python 3:  python3 fixtures/make_stop_helper_fixture.py

- `stop-helper` is the delegate story up to the helper's first `subagent.tool` frame. There the story waits for the
  client's `subagent.interrupt {session_id, subagent_id}` and answers `{found: true, subagent_id}`, as Hermes does when
  the chat's agent runs that helper (gateway/session_ancillary.py `subagent_control`). 1.5 s later, the time a
  helper takes to unwind, comes the helper's `subagent.complete` with status `interrupted`: the recorded complete frame with Hermes's interrupted fields
  (tools/delegate_tool_child_run.py `_build_result_entry`: the summary is the loop's "Operation interrupted."
  placeholder when the helper wrote nothing yet, and no tool output came back). The rest of the first turn follows
  without that helper's other `subagent.*` frames, and without the second turn Hermes starts itself when a helper
  reports back, each frame 1.5 s later than recorded. A last `stored` step holds the first turn's rows. `seq` is renumbered so the stream has no gaps.
- `stop-helper-gone` is the whole delegate story with the same wait, answered `{found: false, subagent_id}`, as
  Hermes answers once the helper is gone. The story then plays on as recorded, so the helper completes.
- `delegate-reopened` is the chat after the delegate story, read again: delegate.jsonl's header with the story's last
  stored rows and, as `todo_state`, the last `todo.updated` payload Hermes keeps for an attach. It has no steps.
"""
import copy
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
DELEGATE = [json.loads(line) for line in (HERE / "delegate.jsonl").read_text().splitlines()]
HEADER, STEPS = DELEGATE[0], DELEGATE[1:]
SESSION = HEADER["sessionId"]


def frame(step):
    push = step.get("push")
    return push["params"] if push is not None and push.get("method") == "event" else None


def of_type(step, kind):
    params = frame(step)
    return params is not None and params["type"] == kind


FIRST_TOOL = next(index for index, step in enumerate(STEPS) if of_type(step, "subagent.tool"))
HELPER = frame(STEPS[FIRST_TOOL])["payload"]["subagent_id"]
STARTED = next(step for step in STEPS if of_type(step, "subagent.start") and frame(step)["payload"]["subagent_id"] == HELPER)
COMPLETE = next(step for step in STEPS if of_type(step, "subagent.complete") and frame(step)["payload"]["subagent_id"] == HELPER)
STORED = [step for step in STEPS if "stored" in step][-1]["stored"]
SECOND_REQUEST = [index for index, row in enumerate(STORED) if row["role"] == "user"][1]
TOOL_AT = STEPS[FIRST_TOOL]["at"]
STOP_MS = 1500


def interrupt(found):
    return {"at": TOOL_AT, "await": "subagent.interrupt", "params": {"session_id": SESSION, "subagent_id": HELPER},
            "reply": {"found": found, "subagent_id": HELPER}}


def interrupted():
    step = copy.deepcopy(COMPLETE)
    step["at"] = TOOL_AT + STOP_MS
    step["push"]["params"]["payload"].update({
        "status": "interrupted", "summary": "Operation interrupted.", "text": "Operation interrupted.", "output_tail": [],
        "duration_seconds": round((TOOL_AT + STOP_MS - STARTED["at"]) / 1000, 2),
    })
    return step


def first_turn_rest():
    turn_end = next(index for index, step in enumerate(STEPS) if of_type(step, "message.complete"))
    end = turn_end + 1
    while end < len(STEPS) and frame(STEPS[end]) is not None and frame(STEPS[end]).get("execution_generation") == 1:
        end += 1
    helpers = lambda step: frame(step)["type"].startswith("subagent.") and frame(step)["payload"].get("subagent_id") == HELPER
    return [{**step, "at": step["at"] + STOP_MS} for step in STEPS[FIRST_TOOL + 1:end] if frame(step) is None or not helpers(step)]


def renumbered(steps):
    out, seq = [], next(frame(step)["seq"] for step in steps if frame(step) is not None)
    for step in steps:
        if frame(step) is not None:
            step = copy.deepcopy(step)
            step["push"]["params"]["seq"] = seq
            seq += 1
        out.append(step)
    return out


def write(name, header, steps):
    lines = [json.dumps(header, ensure_ascii=False)] + [json.dumps(step, ensure_ascii=False) for step in steps]
    (HERE / name).write_text("\n".join(lines) + "\n")


rest = first_turn_rest()
stopped = STEPS[:FIRST_TOOL + 1] + [interrupt(True), interrupted()] + rest + [{"at": rest[-1]["at"], "stored": STORED[:SECOND_REQUEST]}]
write("stop-helper.jsonl", HEADER, renumbered(stopped))
write("stop-helper-gone.jsonl", HEADER, STEPS[:FIRST_TOOL + 1] + [interrupt(False)] + STEPS[FIRST_TOOL + 1:])

last_plan = [frame(step)["payload"] for step in STEPS if of_type(step, "todo.updated")][-1]
write("delegate-reopened.jsonl", {**HEADER, "stored": STORED, "todo_state": last_plan}, [])
