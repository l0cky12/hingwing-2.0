"""Write fixtures/cron.jsonl: a chat Hermes refuses as a scheduled job's chat, beside a newer job chat.

Run with any Python 3:  python3 fixtures/make_cron_fixture.py

The story stands in for a chat a scheduled job owns. Its first `prompt.submit`, of "Check the backups ran", is
admitted and then fails the way Hermes fails any message typed into a cron session
(gateway/session_cron.py:292-305): the turn completes with `outcome: "failed"`, `status: "error"`, Hermes's
English words as its text, and the gateway's `error_surface` (gateway/session_cron.py:156). The complete frame
is shaped like Hermes's `completion_payload` (gateway/session_settlement_recovery.py:40-92): the refused turn
ran nothing, so it carries no `persisted_turn`.

Unlike errand.jsonl this is not a recording. The envelope, the `describe` answer and the frame shapes are
errand.jsonl's own.
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ERRAND = [json.loads(line) for line in (HERE / "errand.jsonl").read_text().splitlines()]
HEADER = ERRAND[0]
SESSION = HEADER["sessionId"]
PROFILE = HEADER["describe"]["profile_id"]
EPOCH = ERRAND[2]["push"]["params"]["replay_epoch"]
CHAT = HEADER["list"]["sessions"][0]

# locales/en.yaml:730, gateway.errors.cron_session_read_only
REFUSAL = "⚠️ This chat belongs to a scheduled job and only runs that job, so your message was not run. Start a new chat to send it."
SURFACE = {"layer": "gateway", "code": "cron_session_read_only", "retryable": False}
JOB_RUN_AT = CHAT["started_at"] + 3600
JOB = {
    **CHAT, "session_id": "local-cron-nightly-backup", "id": "local-cron-nightly-backup", "title": "Nightly backup check",
    "source": "cron", "started_at": JOB_RUN_AT, "message_count": 2, "last_active_at": JOB_RUN_AT,
}
MESSAGE = "Check the backups ran"
ADMISSION = "cron-refused-admission-0001"
INPUT_ID = "input_cron_refused_0001"


class Story:
    def __init__(self):
        self.steps, self.at, self.seq = [], 0, 0

    def add(self, step):
        self.steps.append({"at": self.at, **step})

    def event(self, type, payload, generation=None):
        self.seq += 1
        params = {
            **({"authority_epoch": 1, "execution_generation": generation, "admission_id": ADMISSION} if generation is not None else {}),
            "type": type, "session_id": SESSION, "payload": payload, "replay_epoch": EPOCH, "seq": self.seq,
        }
        self.at += 4
        self.add({"push": {"jsonrpc": "2.0", "method": "event", "params": params}})


def pending(status, generation):
    return {
        "admission_id": ADMISSION, "ref": {"profile_id": PROFILE, "session_id": SESSION}, "sequence": 1, "status": status,
        "outcome": None, "authority_epoch": 1, "execution_generation": generation, "input_id": INPUT_ID, "text": MESSAGE,
        "controls": [], "steering": False,
    }


def info(pending_rows, running, generation):
    return {
        "stored_session_id": SESSION, "pending": pending_rows, "authority_epoch": 1, "desktop_protocol": "hermes-gateway-v1",
        "running": running, "execution_generation": generation, "revision": 0,
    }


story = Story()
story.add({
    "await": "prompt.submit", "params": {"session_id": SESSION, "text": MESSAGE, "input_id": INPUT_ID},
    "reply": {
        "admission_id": ADMISSION, "ref": {"profile_id": PROFILE, "session_id": SESSION}, "sequence": 1, "status": "queued",
        "outcome": None, "authority_epoch": 1, "execution_generation": None,
    },
})
story.event("session.info", info([pending("queued", None)], False, 0))
story.event("message.start", {}, 1)
story.event("session.info", info([pending("started", 1)], True, 1), 1)
story.event("message.complete", {
    "text": REFUSAL, "content": REFUSAL, "admission_id": ADMISSION, "outcome": "failed", "status": "error", "error_surface": SURFACE,
}, 1)
story.event("session.info", info([], False, 1), 1)

header = {
    "fixture": 1, "hermes": HEADER["hermes"], "source": "generated", "sessionId": SESSION, "describe": HEADER["describe"],
    "list": {**HEADER["list"], "sessions": [JOB, CHAT]}, "stored": [],
}
out = HERE / "cron.jsonl"
out.write_text("".join(json.dumps(line, ensure_ascii=False) + "\n" for line in [header, *story.steps]))
print(f"wrote {out}: {len(story.steps)} steps")
