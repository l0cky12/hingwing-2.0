"""Write fixtures/errand.jsonl: one Hermes turn, recorded from Hermes's own canonical gateway.

Run with Hermes's interpreter:  <hermes python> -I fixtures/make_fixture.py

The script runs the canonical gateway in-process, the way Hermes's own
tests/gateway/test_authority_complete_persisted_turn.py does: a real ``SessionAuthority`` over a
real state.db in a throwaway HERMES_HOME, and a real ``AuthorityConnection`` whose transport
records every frame through ``tui_gateway.transport.serialize_frame``, the same serializer the
WebSocket transport uses. The story's calls (``prompt.submit``, ``approval.respond``) go through
``AuthorityConnection.dispatch``, so their params pass the gateway's own closed-key check and their
replies are the gateway's.

Real:
- every envelope (``seq``, ``replay_epoch``, the execution stamp) and the frames the authority
  publishes itself: ``session.info``, ``message.start``, ``approval.request`` / ``approval.settled``
  (``gateway/session_pending_controls.py``) and ``message.complete`` with its ``persisted_turn``;
- the tool frames, built by ``TurnRunner``'s own callbacks (``combined_tool_start_callback``,
  ``combined_tool_complete_callback``, ``_step_callback_sync``, ``_publish_execution``) around real
  tool runs through ``model_tools.handle_function_call`` in /tmp/hermes-proto-work;
- the approval: the real ``terminal`` tool trips Hermes's danger detector and blocks in
  ``tools/approval.py`` until the gateway resolves the prompt;
- the stored rows: the turn's messages are flushed by ``AIAgent._flush_messages_to_session_db``,
  the receipt is ``gateway.run_turn_runner._persisted_turn``, and the ``stored`` step is the
  ``display_messages`` of a real ``session.resume {display_projection: true}``.

Scripted, because no AI provider exists on this machine:
- the assistant's words and its choice of tool calls (``STORY`` below). ``execute_finite_admission``
  is replaced, as the Hermes test above replaces it, by a turn that plays the model's part and
  calls the same ``TurnRunner`` sinks a provider-backed turn calls, in the agent loop's order
  (``agent/turn_iteration_prep.py``, ``agent/turn_tool_round.py``, ``agent/stream_delivery.py``);
- the clock. ``at`` and ``tool.complete.duration_s`` come from a virtual clock so a rerun diffs
  cleanly; tool durations are fixed per call in ``STORY``;
- ids. ``uuid.uuid4`` is seeded, so admission, prompt, turn and epoch ids repeat across runs.

Not emitted, because only a provider produces them: ``thinking.delta`` (spinner text while a request
is in flight), ``reasoning.delta`` and ``session.usage`` (token counts).
"""
import asyncio
import json
import logging
import os
import random
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

SEED = 20261121
_rng = random.Random(SEED)
# Patched before Hermes is imported, so modules that bind ``from uuid import uuid4`` get it too.
uuid.uuid4 = lambda: uuid.UUID(int=_rng.getrandbits(128), version=4)


_version = subprocess.run(["hermes", "--version"], capture_output=True, text=True, check=True).stdout
_found = re.search(r"^Hermes Agent v(\S+)", _version, re.M), re.search(r"^Install directory:\s*(.+)$", _version, re.M)
if not all(_found):
    sys.exit(f"hermes --version printed no version or no 'Install directory:' line:\n{_version}")
HERMES_VERSION, HERMES_DIR = _found[0].group(1), _found[1].group(1).strip()
sys.path.insert(0, HERMES_DIR)
import hermes_bootstrap  # noqa: E402,F401

WORK = "/tmp/hermes-proto-work"
# The gateway's own state lives outside WORK, so the story's `ls -la` lists only what the errand made.
HOME = "/tmp/hermes-proto-home"
OUT = Path(__file__).resolve().parent / "errand.jsonl"
USER = "highwing-fixture"

for path in (WORK, HOME):
    shutil.rmtree(path, ignore_errors=True)
os.makedirs(os.path.join(WORK, "scratch"))
os.makedirs(HOME)
Path(WORK, "scratch", "old.txt").write_text("tmp\n")
# After the bootstrap: pointed at a new home first, it would prepare a whole runtime there.
os.environ["HERMES_HOME"] = HOME

import model_tools  # noqa: E402
from gateway import local_viewer_events, session_finite, session_lifecycle  # noqa: E402
from gateway.config import GatewayConfig, Platform  # noqa: E402
from gateway.run_turn_runner import TurnRunner, _persisted_turn  # noqa: E402
from gateway.session import SessionStore  # noqa: E402
from gateway.session_authority import SessionAuthority  # noqa: E402
from gateway.session_context import clear_session_vars, set_session_vars  # noqa: E402
from gateway.session_controls import AuthorityConnection  # noqa: E402
from persistence_assembly import open_persistence, profile_scope  # noqa: E402
from run_agent import AIAgent  # noqa: E402
from tools.approval import register_gateway_notify, unregister_gateway_notify  # noqa: E402
from tools.approval_context import reset_current_session_key, set_current_session_key  # noqa: E402
from tui_gateway.transport import serialize_frame  # noqa: E402

logging.basicConfig(level=logging.ERROR)

REQUEST = ("In /tmp/hermes-proto-work: make notes.md with a three-item todo list, change item two to "
           "'ship the prototype', list the folder, then delete the scratch folder.")
NOTES = "# Todo\n\n- [ ] sketch the chat view\n- [ ] wire the gateway socket\n- [ ] review screenshots\n"


def final_words() -> str:
    notes = Path(WORK, "notes.md").read_text()
    return ("Done. I created `notes.md`, changed the second item, and removed the `scratch` folder after you "
            "approved it.\n\n```markdown\n" + notes + "```")


def pin_listing_times():
    """``ls -la`` prints mtimes: pin the errand's own entries so the listing repeats. Noon UTC on a day
    more than six months back prints the same date in every time zone, in ``ls``'s year format. The
    ``..`` line describes /tmp itself and still differs between runs."""
    for name in ("scratch/old.txt", "scratch", "notes.md", "."):
        os.utime(os.path.join(WORK, name), (1767268800, 1767268800))


# One entry per model request: the words it streams (a callable when they depend on the tools' work),
# then the tool call it makes, or none to finish. ``ms`` is the virtual time the tool takes, and
# ``stage`` prepares the folder before the tool runs.
STORY = [
    {"say": "I'll create the notes file first, then make the edit.",
     "call": ("write_file", {"path": f"{WORK}/notes.md", "content": NOTES}), "ms": 12},
    {"say": "",
     "call": ("patch", {"mode": "replace", "path": f"{WORK}/notes.md",
                        "old_string": "- [ ] wire the gateway socket", "new_string": "- [ ] ship the prototype"}),
     "ms": 18},
    {"say": "Edited. Checking the folder before I delete anything.",
     "call": ("terminal", {"command": f"cd {WORK} && ls -la && ls scratch"}), "ms": 140,
     "stage": pin_listing_times},
    {"say": "", "call": ("terminal", {"command": f"rm -rf {WORK}/scratch"}), "ms": 95},
    {"say": final_words, "call": None},
]


class Clock:
    """Virtual milliseconds since the story began. ``monotonic`` stands in for ``time.monotonic``
    in ``gateway.local_viewer_events``, which times each tool for ``tool.complete.duration_s``."""

    def __init__(self):
        self.ms = 0
        self.lock = threading.Lock()

    def tick(self, ms):
        with self.lock:
            self.ms += ms

    def now(self):
        with self.lock:
            return self.ms

    def monotonic(self):
        return self.now() / 1000


CLOCK = Clock()
local_viewer_events.time = SimpleNamespace(monotonic=CLOCK.monotonic)
# Wall time for the rows the gateway stores (``timestamp``, ``started_at``): the story starts at
# 2026-11-21 09:00 UTC and moves only with the virtual clock.
STORY_START = 1795251600
time.time = lambda: STORY_START + CLOCK.now() / 1000
# The creation time of the session's routing entry and row (``session_local.stage_local_session``).
session_lifecycle._now = lambda: datetime.fromtimestamp(time.time())


def wire(frame):
    """A frame as the WebSocket transport serializes it."""
    return json.loads(serialize_frame(frame, "fixture", logging.getLogger("fixture")))


class Recorder:
    """The story's socket. ``write`` is its transport, fed by the session's fanout writer thread.
    ``observe`` sees the same frame object synchronously inside ``SessionEvents.publish``, so the
    virtual clock stamps each push in publication order whatever the writer thread's timing."""

    def __init__(self, loop):
        self.steps = []
        self.written = []
        self.recording = False
        self.seen = asyncio.Queue()
        self.loop = loop

    def write(self, obj):
        if self.recording:
            self.written.append(wire(obj))
        return True

    def observe(self, frame):
        if self.recording:
            CLOCK.tick(4)
            self.steps.append({"at": CLOCK.now(), "push": wire(frame)})
            self.loop.call_soon_threadsafe(self.seen.put_nowait, frame)

    async def write_async(self, obj):
        return self.write(obj)

    async def push_of(self, event_type):
        while True:
            frame = await self.seen.get()
            if frame.get("method") == "event" and frame["params"]["type"] == event_type:
                return frame


def flushing_agent(db, session_id):
    """The agent's persistence half: AIAgent's own per-turn flush, which stamps ``_row_id`` on each
    committed message (the shell Hermes's tests use, ``test_authority_complete_persisted_turn.py``)."""
    agent = SimpleNamespace(
        _session_db=db, persistence=db, _session_db_created=True, _persist_disabled=False, session_id=session_id,
        _session_persist_lock=None, _flushed_db_message_ids=set(), _flushed_db_message_session_id=None,
        _last_flushed_db_idx=0, _persist_user_message_idx=None, _persist_user_message_override=None,
        _persist_user_message_timestamp=None, _pending_cli_user_message=None,
        context_compressor=SimpleNamespace(compression_count=0))
    agent._ensure_db_session = lambda: None
    agent._flush_messages_to_session_db = AIAgent._flush_messages_to_session_db.__get__(agent, AIAgent)
    agent._flush_messages_to_session_db_unlocked = AIAgent._flush_messages_to_session_db_unlocked.__get__(
        agent, AIAgent)
    return agent


def play_turn(turn, db, history, call_ids):
    """The agent thread. Plays the model's part and calls the sinks ``TurnRunner`` installs on a
    provider-backed agent for a local viewer's turn (``run_turn_runner.py`` ``_wire_agent``)."""
    authority, session_id, generation = turn._approval_owner
    agent = flushing_agent(db, session_id)
    messages = list(history) + [{"role": "user", "content": REQUEST}]
    agent._persist_user_message_idx = len(history)
    session_key = turn._ctx.session_key

    def notify(data):
        # ``TurnRunner._approval_notify_sync`` for a local viewer: its ``_render_approval_sync`` paints
        # a chat adapter's card, and a local route has none, so only the canonical registration remains.
        authority.check_approval_generation(session_id, generation)
        authority.register_approval(session_id, generation, session_key, data,
                                    timeout_s=local_viewer_events.prompt_timeout_s(turn, "approval"))

    tokens = set_session_vars(platform=Platform.LOCAL.value, session_key=session_key, session_id=session_id,
                              user_id=USER, cwd=WORK)
    key_token = set_current_session_key(session_key)
    register_gateway_notify(session_key, notify)
    needs_break = False
    streamed = False
    try:
        for iteration, step in enumerate(STORY, start=1):
            turn._ctx._step_callback_sync(iteration, [])
            words = step["say"]() if callable(step["say"]) else step["say"]
            if words:
                text = ("\n\n" + words) if needs_break else words
                needs_break = False
                for i in range(0, len(text), 24):
                    CLOCK.tick(30)
                    turn._publish_execution("message.delta", {"text": text[i:i + 24]})
                streamed = True
            if step["call"] is None:
                messages.append({"role": "assistant", "content": words or ""})
                break
            name, args = step["call"]
            call_id = call_ids[iteration - 1]
            CLOCK.tick(60)
            turn._publish_execution("tool.generating", {"name": name})
            messages.append({"role": "assistant", "content": words or "", "tool_calls": [
                {"id": call_id, "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}]})
            agent._flush_messages_to_session_db(messages, history)
            # ``turn_tool_round.py``: the open text box closes before the tool lines.
            turn._publish_execution("message.delta", {"text": None})
            turn.combined_tool_start_callback(call_id, name, args)
            if "stage" in step:
                step["stage"]()
            result = model_tools.handle_function_call(name, args, task_id=session_id, tool_call_id=call_id,
                                                      session_id=session_id)
            CLOCK.tick(step["ms"])
            turn.combined_tool_complete_callback(call_id, name, args, result)
            messages.append({"role": "tool", "tool_call_id": call_id, "content": result})
            agent._flush_messages_to_session_db(messages, history)
            needs_break = streamed
    finally:
        unregister_gateway_notify(session_key)
        reset_current_session_key(key_token)
        clear_session_vars(tokens)
    agent._flush_messages_to_session_db(messages, history)
    final = messages[-1]["content"]
    result = {"final_response": final, "messages": messages}
    receipt = _persisted_turn(agent, history, result, 0)
    # The fields ``TurnRunner`` adds for a local viewer's turn (``run_turn_runner.py``, the final return).
    return {**result, **({"persisted_turn": receipt} if receipt else {}), "local_viewer": True,
            "last_reasoning": None, "response_previewed": False, "response_transformed": False}


async def main():
    db = open_persistence(profile_scope(home=HOME))
    # Hermes's own `owner` test fixture (tests/gateway/conftest.py): the routing store and the
    # authority share the profile's state.db. The runner is a stand-in with no adapters and no agent.
    store = SessionStore(config=GatewayConfig(), sessions_dir=Path(HOME) / "sessions")
    store._db, store._persistence_beside = db, lambda pinned: pinned
    runner = SimpleNamespace(_draining=False, session_store=store, adapters={},
                             _adapter_for_source=lambda source: None, _evict_cached_agent=lambda route: None,
                             _cached_agent_for=lambda route: None)
    authority = SessionAuthority(runner, profile_id=HOME, instance_id="fixture",
                                 epoch=db.runtime.begin_epoch(instance_id="fixture"), persistence=db)
    runner.session_authority = authority
    recorder = Recorder(asyncio.get_running_loop())
    socket = AuthorityConnection(authority, recorder, {"user_id": USER, "native_bootstrap": True})
    rpc_id = 0

    async def call(connection, method, params):
        nonlocal rpc_id
        rpc_id += 1
        reply = await connection.dispatch({"jsonrpc": "2.0", "id": rpc_id, "method": method, "params": params})
        if "error" in reply:
            sys.exit(f"{method} refused: {reply['error']}")
        return reply

    created = (await call(socket, "session.create", {}))["result"]
    session_id = created["session_id"]
    live = authority.sessions[session_id]
    live.event_stream.observers.add(recorder.observe)
    describe = (await call(socket, "runtime.describe", {}))["result"]
    listing = (await call(socket, "session.list", {}))["result"]
    history = []
    call_ids = ["call_" + uuid.uuid4().hex[:24] for _ in STORY]

    async def scripted_execution(authority, ref, row):
        turn = TurnRunner.__new__(TurnRunner)
        turn._runner = runner
        turn._approval_owner = (authority, ref.session_id, row["generation"])
        turn._ctx = SimpleNamespace(
            source=live.source, session_id=ref.session_id, session_key=live.route,
            _loop_for_step=asyncio.get_running_loop(), _run_still_current=lambda: True,
            _voice_ack_guild=[None], _native_slack_task_cards=False, progress_mode=None, agent_holder=[None],
            _hooks_ref=SimpleNamespace(loaded_hooks=[]), progress_queue=None)
        turn._ctx._step_callback_sync = lambda iteration, prev: TurnRunner._step_callback_sync(turn, iteration, prev)
        result = await asyncio.to_thread(play_turn, turn, db, history, call_ids)
        authority.pending_results[row["admission_id"]] = {"result": result, "usage": {}}
        # The event stream delivered the reply, so the handler answers None and ``message.complete``
        # carries ``text: null`` (tests/gateway/test_local_viewer_transformed_final.py).
        return None

    session_finite.execute_finite_admission = scripted_execution

    async def story_call(method, params):
        """The client's call as an ``await`` step. Events reach a socket through its own writer thread
        and replies go out directly (``tui_gateway/transport.py`` ``FanoutTransport``), so a push
        published while the call is handled may arrive on either side of the reply. The fixture plays
        it after the reply."""
        at, mark = CLOCK.now(), len(recorder.steps)
        reply = await call(socket, method, params)
        recorder.steps.insert(mark, {"at": at, "await": method, "params": params, "reply": reply["result"]})

    recorder.recording = True
    await story_call("prompt.submit", {"session_id": session_id, "text": REQUEST,
                                       "input_id": "input_" + uuid.uuid4().hex[:16]})
    try:
        request = await asyncio.wait_for(recorder.push_of("approval.request"), 60)
    except TimeoutError:
        sys.exit("the gateway never asked to approve the rm -rf")
    prompt = request["params"]["payload"]
    CLOCK.tick(1500)
    await story_call("approval.respond", {"session_id": session_id, "execution_generation": prompt["execution_generation"],
                                          "prompt_id": prompt["prompt_id"], "choice": "once"})

    await live.task
    pushes = [step["push"] for step in recorder.steps if "push" in step]
    for _ in range(100):
        if len(recorder.written) >= len(pushes):
            break
        await asyncio.sleep(0.05)
    recorder.recording = False
    if recorder.written != pushes:
        sys.exit("the socket received other frames than the session published")

    # A second viewer opening the chat now: the rows a resume with history returns.
    reader = AuthorityConnection(authority, SimpleNamespace(write=lambda obj: True), {"user_id": USER})
    snapshot = (await call(reader, "session.resume", {"session_id": session_id, "display_projection": True}))["result"]
    CLOCK.tick(4)
    recorder.steps.append({"at": CLOCK.now(), "stored": snapshot["display_messages"]})

    # A new session stores no rows yet.
    header = {"fixture": 1, "hermes": HERMES_VERSION, "source": "generated", "sessionId": session_id,
              "describe": describe, "list": listing, "stored": created["messages"]}
    with OUT.open("w") as out:
        for line in [header, *recorder.steps]:
            out.write(json.dumps(line, ensure_ascii=False) + "\n")
    db.close()
    print(f"wrote {OUT}: {len(pushes)} pushes, {len(recorder.steps) - len(pushes)} other steps", file=sys.stderr)
    if os.path.exists(f"{WORK}/scratch"):
        sys.exit("the approved rm -rf did not remove the scratch folder")


asyncio.run(main())
