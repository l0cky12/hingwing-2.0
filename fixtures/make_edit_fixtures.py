"""Write fixtures/edit.jsonl, fixtures/regenerate.jsonl, fixtures/edit-refused.jsonl, fixtures/edit-compacted.jsonl,
fixtures/branch.jsonl, fixtures/branch-old.jsonl and fixtures/branch-compacted.jsonl.

Run with any Python 3:  python3 fixtures/make_edit_fixtures.py

Each fixture is a chat with three stored turns whose user rows carry `row_id`s. The story waits for the
client's `session.mutate` rewind, publishes the `session.updated` receipt, plays the rows left after the cut
as a `stored` step, then waits for the `prompt.submit` that follows and plays one reply turn. That turn
holds a two second tool step, so a live run can see it running. Its `message.complete` carries the
`persisted_turn` receipt with `row_ids` and `user_row_id`, and a last `stored` step holds the rows after it.

- `edit` cuts before the second user row (one later turn goes) and sends the corrected text.
- `regenerate` cuts before the last user row and sends the same text again.
- `edit-refused` answers the rewind with Hermes's refusal for a row that is gone (`invalid_params`, field
  `target_message_id`) and has no step after it.
- `edit-compacted` is the compacted chat below. It answers a rewind of the first message with Hermes's refusal for a
  row compaction archived: field `target_message_id` and a `compacted:` detail (persistence/authority/runtime.py:68-69).

- `branch` has no steps and its header says `branches`. Its chat is titled "Notes heading" so a branch has a title to
  number: "Notes heading #2".
- `branch-old` is the same chat on a Hermes that cannot branch: its header has no `branches`.
- `branch-compacted` is the compacted chat with `branches`.

The compacted chat is the same three turns after Hermes compacted the first one away: a `row_kind: 'compaction'` row
sits between the first turn and the second, as `session.transcript` gives it (gateway/session_transcript_rows.py:25-31).
The rows after it are the continuation's, with larger ids.

Unlike errand.jsonl this is not a recording of Hermes's gateway. The envelope, the `describe` and `list`
answers and the frame shapes are errand.jsonl's own. The receipt is built from Hermes's rewind
(persistence/sqlite/authority/_mutation.py `_rewind` and `session_mutations.py`, which publishes the
mutation result as `session.updated`): `rewound_count`, `target_message`, `new_head_id` and
`replacement_message_id` beside the new `revision` and `execution_generation`.
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ERRAND = [json.loads(line) for line in (HERE / "errand.jsonl").read_text().splitlines()]
HEADER = ERRAND[0]
SESSION = HEADER["sessionId"]
PROFILE = HEADER["describe"]["profile_id"]
EPOCH = ERRAND[2]["push"]["params"]["replay_epoch"]
FIRST_ROW_TIME = 1795251600

TURNS = [
    ("Rename the heading in notes.md to Plan", "Done. The heading in `notes.md` now reads \"Plan\"."),
    ("Add a line about the deadline under it", "Added \"Due Friday\" under the heading."),
    ("List the folder", "The folder holds `notes.md` and a `scratch` folder."),
]
EDITED = "Add a line about the Friday deadline under it"
EDITED_REPLY = "Added \"Due Friday\" under the heading, as a new line."
REGENERATED_REPLY = "Here is the folder:\n\n- `notes.md`\n- `scratch/`"
APPEND = {"command": "printf '\\n- Due Friday\\n' >> notes.md", "context": "append to notes.md", "said": "I'll add the line to notes.md first.", "output": ""}
LISTING = {
    "command": "ls -la", "context": "ls -la", "said": "I'll check the folder first.",
    "output": "total 4\n-rw-r--r--  1 liam liam   42 Jan  1  2026 notes.md\ndrwxr-xr-x  2 liam liam   60 Jan  1  2026 scratch",
}
TOOL_MS = 2000


def rows_of(turns, first_id=1, start=0):
    rows, row_id = [], first_id
    for index, (ask, answer) in enumerate(turns):
        at = FIRST_ROW_TIME + start + index * 10
        rows.append({"role": "user", "text": ask, "timestamp": at, "row_id": row_id})
        rows.append({"role": "assistant", "text": answer, "timestamp": at + 1, "row_id": row_id + 1})
        row_id += 2
    return rows


STORED = rows_of(TURNS)
COMPACTED = [
    *rows_of(TURNS[:1]),
    {"row_kind": "compaction", "role": "system", "text": "Renamed the heading in notes.md to Plan.", "compacted_messages": 2,
     "row_id": 3, "timestamp": FIRST_ROW_TIME + 9},
    *rows_of(TURNS[1:], first_id=4, start=10),
]
COMPACTED_DETAIL = "compacted: target user message was summarized when the session was compressed"


class Story:
    def __init__(self):
        self.steps, self.at, self.seq = [], 0, 0

    def after(self, ms):
        self.at += ms

    def add(self, step):
        self.steps.append({"at": self.at, **step})

    def event(self, type, payload, generation=None, admission=None):
        self.seq += 1
        params = {
            **({"authority_epoch": 1, "execution_generation": generation} if generation is not None else {}),
            **({"admission_id": admission} if admission else {}),
            "type": type, "session_id": SESSION, "payload": payload, "replay_epoch": EPOCH, "seq": self.seq,
        }
        self.after(4)
        self.add({"push": {"jsonrpc": "2.0", "method": "event", "params": params}})


def rewind(story, row_id, kept, rewound):
    params = {
        "session_id": SESSION, "request_id": f"request_rewind_{row_id:04d}", "expected_revision": 0,
        "expected_generation": 0, "operation": "rewind", "payload": {"target_message_id": row_id},
    }
    return params, {
        "session_id": SESSION, "revision": 1, "execution_generation": 1, "operation": "rewind",
        "rewound_count": rewound, "new_head_id": kept[-1]["row_id"] if kept else None, "replacement_message_id": None,
        "target_message": {"id": row_id, "role": "user", "content": next(r["text"] for r in STORED if r["row_id"] == row_id)},
    }


def pending(admission, input_id, text, status, generation, controls):
    return {
        "admission_id": admission, "ref": {"profile_id": PROFILE, "session_id": SESSION}, "sequence": 1, "status": status,
        "outcome": None, "authority_epoch": 1, "execution_generation": generation, "input_id": input_id, "text": text,
        "controls": controls, "steering": False,
    }


def info(pending_rows, running, generation, revision):
    return {
        "stored_session_id": SESSION, "pending": pending_rows, "authority_epoch": 1, "desktop_protocol": "hermes-gateway-v1",
        "running": running, "execution_generation": generation, "revision": revision,
    }


def story_for(cut_row, kept_turns, text, reply, slug, tool_call):
    story = Story()
    kept = rows_of(kept_turns)
    params, receipt = rewind(story, cut_row, kept, 2 * (len(TURNS) - len(kept_turns)))
    story.add({"await": "session.mutate", "params": params, "reply": receipt})
    story.event("session.updated", receipt)
    story.after(4)
    story.add({"stored": kept})

    admission = f"{slug}-admission-0001"
    input_id = f"input_{slug}_0001"
    story.after(4)
    story.add({
        "await": "prompt.submit", "params": {"session_id": SESSION, "text": text, "input_id": input_id},
        "reply": {
            "admission_id": admission, "ref": {"profile_id": PROFILE, "session_id": SESSION}, "sequence": 1, "status": "queued",
            "outcome": None, "authority_epoch": 1, "execution_generation": None,
        },
    })
    queued = pending(admission, input_id, text, "queued", None, ["steer", "replace"])
    started = pending(admission, input_id, text, "started", 2, [])
    story.event("session.info", info([queued], False, 1, 1))
    story.event("message.start", {}, 2, admission)
    story.event("session.info", info([started], True, 2, 1), 2, admission)
    story.event("agent.step", {"iteration": 1}, 2, admission)

    first_words = tool_call["said"]
    for index in range(0, len(first_words), 14):
        story.after(30)
        story.event("message.delta", {"text": first_words[index:index + 14], "turn_id": f"{slug}-turn", "segment": 0, "offset": index}, 2, admission)
    call_id = f"call_{slug}_terminal"
    command = {"command": tool_call["command"]}
    tool = {"tool_id": call_id, "name": "terminal", "context": tool_call["context"], "tool_call_id": call_id, "tool_name": "terminal", "args": command}
    story.after(40)
    story.event("tool.generating", {"name": "terminal"}, 2, admission)
    story.event("message.delta", {"text": None}, 2, admission)
    story.event("tool.start", tool, 2, admission)
    story.after(TOOL_MS)
    result = json.dumps({"output": tool_call["output"], "exit_code": 0, "error": None, "cwd": "/tmp/hermes-proto-work"})
    story.event("tool.complete", {**tool, "is_error": False, "result": result, "duration_s": TOOL_MS / 1000, "inline_diff": None, "image_path": None}, 2, admission)
    story.event("agent.step", {"iteration": 2}, 2, admission)
    offset = len(first_words)
    spoken = "\n\n" + reply
    for index in range(0, len(spoken), 24):
        story.after(30)
        chunk = spoken[index:index + 24]
        story.event("message.delta", {"text": chunk, "turn_id": f"{slug}-turn", "segment": 0, "offset": offset}, 2, admission)
        offset += len(chunk)

    first_new = 2 * len(TURNS) + 1
    row_ids = [first_new + n for n in range(4)]
    story.after(4)
    story.event("message.complete", {
        "text": None, "content": None, "admission_id": admission, "outcome": "completed", "status": "complete",
        "persisted_turn": {
            "row_ids": row_ids, "complete": True, "user_row_id": row_ids[0], "user_row_ids": [row_ids[0]],
            "final_assistant_row_id": row_ids[-1], "submission_id": input_id,
        },
    }, 2, admission)
    story.event("session.info", info([], False, 2, 2), 2, admission)

    at = FIRST_ROW_TIME + 100
    story.after(4)
    story.add({"stored": [
        *kept,
        {"role": "user", "text": text, "timestamp": at, "row_id": row_ids[0]},
        {"role": "assistant", "text": first_words, "timestamp": at + 1, "row_id": row_ids[1]},
        {"role": "tool", "name": "terminal", "context": tool_call["context"], "content": result, "tool_call_id": call_id, "timestamp": at + 2, "args": command},
        {"role": "assistant", "text": reply, "timestamp": at + 3, "row_id": row_ids[3]},
    ]})
    return story.steps


def refused_story(cut_row, detail="target user message is no longer in session history"):
    story = Story()
    params, _ = rewind(story, cut_row, [], 0)
    error = {"code": 4001, "message": "invalid_params", "data": {"reason": "invalid_params", "field": "target_message_id", "detail": detail}}
    story.add({"await": "session.mutate", "params": params, "error": error})
    return story.steps


TITLED = {**HEADER["list"], "sessions": [{**HEADER["list"]["sessions"][0], "title": "Notes heading"}]}


def write(name, steps, **more):
    header = {
        "fixture": 1, "hermes": HEADER["hermes"], "source": "generated", "sessionId": SESSION,
        "describe": HEADER["describe"], "list": HEADER["list"], "stored": STORED, **more,
    }
    path = HERE / f"{name}.jsonl"
    path.write_text("".join(json.dumps(line, ensure_ascii=False) + "\n" for line in [header, *steps]))
    print(f"wrote {path}: {len(steps)} steps")


write("edit", story_for(3, TURNS[:1], EDITED, EDITED_REPLY, "edit", APPEND))
write("regenerate", story_for(5, TURNS[:2], TURNS[2][0], REGENERATED_REPLY, "regenerate", LISTING))
write("edit-refused", refused_story(3))
write("edit-compacted", refused_story(1, COMPACTED_DETAIL), stored=COMPACTED)
write("branch", [], list=TITLED, branches=True)
write("branch-old", [], list=TITLED)
write("branch-compacted", [], list=TITLED, branches=True, stored=COMPACTED)
