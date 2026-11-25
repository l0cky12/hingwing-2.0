"""Write fixtures/btw.jsonl: two side questions asked while a turn runs, answered in the other order.

Run with any Python 3:  python3 fixtures/make_btw_fixture.py

Derived from fixtures/commands.jsonl, not a recording. The header is commands.jsonl's own (its `catalog`
lists `/btw`, and its `info` holds the switches). The story plays commands.jsonl's first turn up to its
first `agent.step`, so the turn is running, then asks two side questions with `prompt.btw`. Their
`btw.complete` answers come in the opposite order to the asking, three seconds before the reply
streams. The turn then finishes as recorded, and one last `btw.complete` arrives for a `task_id` this
client never asked, as when another client asks a side question in the same chat.

Every inserted push copies the envelope of the `btw.complete` that commands.jsonl recorded from Hermes's
gateway: no generation, the chat's `replay_epoch`, and the next `seq`. The recorded frames after an
insert get their `seq` renumbered so the chat's stream stays consecutive.
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
RECORDED = [json.loads(line) for line in (HERE / "commands.jsonl").read_text().splitlines()]
HEADER, STEPS = RECORDED[0], RECORDED[1:]
SESSION = HEADER["sessionId"]
ANSWER_FRAME = next(step for step in STEPS if step.get("push", {}).get("params", {}).get("type") == "btw.complete")
EPOCH = ANSWER_FRAME["push"]["params"]["replay_epoch"]

RUNNING = STEPS[:5]
REPLY = STEPS[5:11]
assert RUNNING[0]["await"] == "prompt.submit" and RUNNING[-1]["push"]["params"]["type"] == "agent.step"
assert REPLY[-1]["push"]["params"]["type"] == "message.complete"

ASKED = [
    ("btw_1f0a2c", "why?", "Because the release notes are the only file that lists the open tasks."),
    ("btw_8e41d7", "what does this flag do?", "It turns on **dry-run** mode, so nothing is written."),
]
ELSEWHERE = ("btw_elsewhere", "Which branch is this on?", "main.")


class Story:
    def __init__(self, at, seq):
        self.steps, self.at, self.seq = [], at, seq

    def after(self, ms):
        self.at += ms

    def add(self, step):
        self.steps.append({"at": self.at, **step})

    def recorded(self, step):
        if "push" in step and "seq" in step["push"]["params"]:
            self.seq += 1
            step = {**step, "push": {**step["push"], "params": {**step["push"]["params"], "seq": self.seq}}}
        self.steps.append({**step, "at": self.at})

    def answer(self, task_id, question, text):
        self.seq += 1
        params = {"type": "btw.complete", "session_id": SESSION, "payload": {"task_id": task_id, "question": question, "text": text}, "replay_epoch": EPOCH, "seq": self.seq}
        self.add({"push": {"jsonrpc": "2.0", "method": "event", "params": params}})


story = Story(RUNNING[-1]["at"], RUNNING[-1]["push"]["params"]["seq"])
story.steps.extend(RUNNING)

for task_id, question, _ in ASKED:
    story.after(500)
    story.add({"await": "prompt.btw", "params": {"session_id": SESSION, "text": question}, "reply": {"task_id": task_id}})
story.after(400)
story.answer(*ASKED[1])
story.after(800)
story.answer(*ASKED[0])
story.after(3000)

shift = story.at - RUNNING[-1]["at"]
for step in REPLY:
    story.at = step["at"] + shift
    story.recorded(step)
story.after(500)
story.answer(*ELSEWHERE)

path = HERE / "btw.jsonl"
path.write_text("".join(json.dumps(line, ensure_ascii=False) + "\n" for line in [HEADER, *story.steps]))
print(f"wrote {path}: {len(story.steps)} steps")
