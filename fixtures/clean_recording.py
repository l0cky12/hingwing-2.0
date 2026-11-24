"""Turn a raw recording from scripts/record-fixture.ts into a fixture that is safe to commit.

Run:  python3 -I fixtures/clean_recording.py <raw.jsonl> <out.jsonl> [--hermes-home <path>] [--user <name>]

The frames stay as Hermes sent them, apart from these changes:
- The header keeps ``describe`` and ``stored``. Its ``list`` holds only the recorded session (made from
  the first listed row when the list was read before the chat existed), and the
  ``catalog`` and ``profiles`` replies are left out, because they name the user's other chats, skills
  and bots.
- Steps before the story's first call that only repeat the header's stored rows are left out.
- ``drop`` steps are left out: the recorder writes one when it closes its own socket.
- ``at`` counts from the first step that is kept.
- The payload keys in ``DROPPED`` are left out. ``session.info`` carries Hermes's whole system prompt,
  memory included, the tools the profile has and a hint of the provider key. A ``subagent.*`` frame
  lists every toolset of the profile. Highwing reads none of these.
- The Hermes home and the user name are replaced everywhere, ``--hermes-home`` (default
  ``~/.hermes``) with ``/tmp/hermes-proto-home`` and ``--user`` (default ``$USER``) with ``user``.

It fails if the user name is still in the output, so read the output before committing it anyway.
"""
import argparse
import json
import os
import re
import sys
from pathlib import Path

HOME_AS = "/tmp/hermes-proto-home"
DROPPED = {
    "session.info": {"system_prompt", "tools", "credential_hint"},
    **{f"subagent.{kind}": {"toolsets"} for kind in ("spawn_requested", "start", "thinking", "tool", "progress", "complete")},
}
USER_AS = "user"


def scrub(text: str, hermes_home: str, user: str) -> str:
    text = text.replace(hermes_home, HOME_AS)
    text = text.replace(f"/home/{user}", f"/home/{USER_AS}")
    return re.sub(rf"\b{re.escape(user)}\b", USER_AS, text)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("raw")
    parser.add_argument("out")
    parser.add_argument("--hermes-home", default=str(Path.home() / ".hermes"))
    parser.add_argument("--user", default=os.environ.get("USER", ""))
    args = parser.parse_args()
    if not args.user:
        sys.exit("name the user with --user")

    lines = Path(args.raw).read_text().splitlines()
    header = json.loads(lines[0])
    steps = [json.loads(line) for line in lines[1:]]
    session = header["sessionId"]

    listed = header["list"].get("sessions", [])
    rows = [row for row in listed if row.get("session_id") == session]
    if not rows and listed:
        rows = [{**listed[0], "session_id": session, "id": session, "title": "", "message_count": 0, "running": False}]
    kept_header = {
        "fixture": header["fixture"],
        "hermes": header["hermes"],
        "source": "recorded",
        "sessionId": session,
        "describe": header["describe"],
        "list": {**header["list"], "sessions": rows},
        "stored": header["stored"],
    }

    first_call = next(index for index, step in enumerate(steps) if "await" in step)
    kept = [
        step for index, step in enumerate(steps)
        if "drop" not in step and not (index < first_call and step.get("stored") == header["stored"])
    ]
    for step in kept:
        params = step.get("push", {}).get("params")
        if isinstance(params, dict) and isinstance(params.get("payload"), dict):
            params["payload"] = {key: value for key, value in params["payload"].items() if key not in DROPPED.get(params.get("type"), ())}
    start = kept[0]["at"]
    kept = [{**step, "at": step["at"] - start} for step in kept]

    text = "\n".join(json.dumps(value, ensure_ascii=False) for value in [kept_header, *kept]) + "\n"
    text = scrub(text, args.hermes_home, args.user)
    if re.search(rf"\b{re.escape(args.user)}\b", text, re.IGNORECASE):
        sys.exit(f"{args.user} is still in the output")
    Path(args.out).write_text(text)
    print(f"{args.out}: {len(kept)} steps, {len(text)} bytes")


main()
