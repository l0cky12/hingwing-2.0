"""Build events.jsonl for the prototype from REAL Hermes tool runs.

Real: every tool.start / tool.complete payload (Hermes's own tool handlers and its own
tui_gateway payload builder), and the approval description (Hermes's own danger detector).
Scripted: the assistant prose, because no AI provider is configured on this machine.
Run with Hermes's interpreter:  <hermes python> -I make_fixture.py
"""
import json
import os
import shutil
import sys
import time
import uuid

sys.path.insert(0, "/home/liam/.hermes/hermes-agent")
import hermes_bootstrap  # noqa: E402,F401
import model_tools  # noqa: E402
import tui_gateway.server as srv  # noqa: E402
from tools.approval_detection import detect_dangerous_command  # noqa: E402

WORK = "/tmp/hermes-proto-work"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "events.jsonl")
SID = "fixture-session"

shutil.rmtree(WORK, ignore_errors=True)
os.makedirs(os.path.join(WORK, "scratch"))
open(os.path.join(WORK, "scratch", "old.txt"), "w").write("tmp\n")

frames = []
t0 = time.time()
seq = 0


def push(frame):
    frames.append({"t": int((time.time() - t0) * 1000), "frame": frame})


def event(kind, payload):
    global seq
    seq += 1
    push({"kind": "event", "type": kind, "session_id": SID, "seq": seq, "payload": payload, "scripted": kind.startswith("message.")})


def captured_emit(kind, sid, payload=None):
    event(kind, payload or {})
    return True


srv._emit = captured_emit
srv._session_verbose = lambda sid: True
srv._tool_progress_enabled = lambda sid: True
srv._sessions[SID] = {}


def run_tool(name, args):
    call_id = "call_" + uuid.uuid4().hex[:10]
    event("tool.generating", {"name": name})
    srv._sessions[SID].setdefault("tool_started_at", {})[call_id] = time.time()
    srv._on_tool_start(SID, call_id, name, args)
    result = model_tools.handle_function_call(name, args, task_id="proto", tool_call_id=call_id, session_id=SID)
    srv._on_tool_complete(SID, call_id, name, args, result)
    return result


def say(text):
    # Stream in small chunks the way message.delta arrives.
    for i in range(0, len(text), 24):
        event("message.delta", {"text": text[i:i + 24], "turn_id": "turn-1"})


push({"kind": "local", "type": "user", "text": "In /tmp/hermes-proto-work: make notes.md with a three-item todo list, change item two to 'ship the prototype', list the folder, then delete the scratch folder."})
event("message.start", {"turn_id": "turn-1"})
say("I'll create the notes file first, then make the edit.\n\n")
run_tool("write_file", {"path": f"{WORK}/notes.md", "content": "# Todo\n\n- [ ] sketch the chat view\n- [ ] wire the gateway socket\n- [ ] review screenshots\n"})
run_tool("patch", {"mode": "replace", "path": f"{WORK}/notes.md", "old_string": "- [ ] wire the gateway socket", "new_string": "- [ ] ship the prototype"})
say("Edited. Checking the folder before I delete anything.\n\n")
run_tool("terminal", {"command": f"cd {WORK} && ls -la && ls scratch"})

command = f"rm -rf {WORK}/scratch"
dangerous, pattern_key, description = detect_dangerous_command(command)
print("detector:", dangerous, pattern_key, description, file=sys.stderr)
prompt_id = "prompt_" + uuid.uuid4().hex[:8]
push({"kind": "event", "type": "approval.request", "session_id": SID, "execution_generation": 1,
      "payload": {"prompt_id": prompt_id, "kind": "approval", "command": command,
                  "description": description or "recursive delete", "choices": ["once", "session", "always", "deny"],
                  "execution_generation": 1}})
push({"kind": "local", "type": "approval.answered", "request_id": prompt_id, "choice": "once"})
run_tool("terminal", {"command": command})

notes = open(f"{WORK}/notes.md").read()
say("Done. I created `notes.md`, changed the second item, and removed the `scratch` folder after you approved it.\n\n"
    "```markdown\n" + notes + "```\n")
event("message.complete", {"status": "complete"})

with open(OUT, "w") as f:
    for fr in frames:
        f.write(json.dumps(fr, default=str) + "\n")
print(f"wrote {len(frames)} frames to {OUT}", file=sys.stderr)
print("scratch still exists:", os.path.exists(f"{WORK}/scratch"), file=sys.stderr)
