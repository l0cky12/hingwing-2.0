"""Write one story's fixture: one Hermes turn, recorded from Hermes's own canonical gateway.

Run with Hermes's interpreter:  <hermes python> -I fixtures/make_fixture.py [story]

The stories are in ``STORIES``:
- ``errand`` (the default) writes fixtures/errand.jsonl. Its turn asks to delete a folder, the story
  answers ``once``, and the fixture ends with the settled turn's ``stored`` rows.
- ``long-turn`` writes fixtures/long-turn.jsonl: a turn with enough steps to overflow the window. The
  fixture ends at its ``approval.request``; the script then answers ``deny`` off the record so the
  turn can finish.
- ``markdown`` writes fixtures/markdown.jsonl: a text-only reply that holds a list, a heading, a
  link, a table, an ``sh`` block and a ``ts`` block. It asks for no approval.
- ``images`` writes fixtures/images.jsonl: a tool step whose ``tool.complete`` carries ``image_path``
  and a reply whose Markdown holds an image. It asks for no approval. Its header also carries
  ``media``, the bytes of both images by the path or URL the thread asks for.
- ``preview`` writes fixtures/preview.jsonl: a step writes fixtures/preview/index.html into the work
  dir, Hermes's own ``desktop_preview`` tool opens ``http://localhost:5173/`` labelled ``demo``, and
  the reply links to that page and to an address that never resolves. It asks for no approval.
- ``preview-close`` writes fixtures/preview-close.jsonl: the same page opens, and after a 2 s pause
  ``desktop_preview`` closes the pane.
- ``preview-files`` writes fixtures/preview-files.jsonl: steps write a CSV, a two-page PDF, a CSV whose
  quoted fields hold a comma and a newline, and a ``.pdf`` that is plain text, all into the work dir's
  ``reports`` folder. Two more steps edit the header of a 20,000-row CSV and of a CSV over the preview's
  10 MB limit, which the story puts in the work dir before the turn. It asks for no approval.
- ``says`` writes fixtures/says.jsonl: a turn in which Hermes says everything a local viewer hears
  beside the reply (reasoning, a MoA round, a tool's image, compaction lines, a printed line, a
  notice shown and cleared), asks to approve an ``rm -rf`` that carries ``timeout_s``, and then, with
  no turn running, says a ``/goal`` verdict. The story turns the chat's reasoning display on first
  and the header keeps the ``config.get`` answer for it as ``controls`` and the tool image's bytes as
  ``media``.
- ``asks`` writes fixtures/asks.jsonl: a turn in which Hermes asks its viewers for things outside
  the turn's own prompts, then one more question while no turn runs. In order: a ``sudo`` password,
  answered (the recorded result is masked); a skill's ``secret``, skipped; a ``vault.code``, answered
  by a second viewer, so this one only hears ``request.cancel``; a two-question ``clarify`` batch,
  answered by two ``clarify.lock`` calls; the ``manage_connections`` card, whose one target is
  skipped with ``connection.respond`` and which then settles; a ``theme.pick`` window request, which
  the story declines as a client with a window on the chat and no picker does; and, after the turn,
  a plugin command's choice.

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
  the receipt is ``gateway.run_turn_runner._persisted_turn``, and a ``stored`` step is the
  ``display_messages`` of a real ``session.resume {display_projection: true}``.

Scripted, because no AI provider exists on this machine:
- the assistant's words and its choice of tool calls (each story's ``steps``). ``execute_finite_admission``
  is replaced, as the Hermes test above replaces it, by a turn that plays the model's part and
  calls the same ``TurnRunner`` sinks a provider-backed turn calls, in the agent loop's order
  (``agent/turn_iteration_prep.py``, ``agent/turn_tool_round.py``, ``agent/stream_delivery.py``);
- the window events: each turn is wired with ``gateway.local_desktop_ui.wire``, as
  ``local_viewer_events`` wires a local viewer's turn, so ``desktop_preview`` publishes its real
  ``preview.open`` and ``preview.close`` on the turn's stream;
- the ``screenshot`` tool of the ``images`` story. Hermes ships no tool that returns an ``image_path``
  without a browser, so the script registers one in ``tools.registry`` that draws a PNG into the work
  dir. ``image_path`` on its ``tool.complete`` is still Hermes's own (``tool_image_path``), read from
  that result when the file exists;
- the clock. ``at`` and ``tool.complete.duration_s`` come from a virtual clock so a rerun diffs
  cleanly; tool durations, and any pause before a step, are fixed per call in the story's ``steps``;
- ids. ``uuid.uuid4`` is seeded per story, so admission, prompt, turn and epoch ids repeat across
  runs and differ between fixtures.

Real in ``says``, from Hermes's own emitters on the same turn:
- the chat's reasoning display, set by a real ``config.set show_reasoning`` and read back by
  ``config.get`` (``gateway/session_busy_controls.py``) before the recording starts;
- ``reasoning.delta`` and ``agent.print`` through the sinks ``local_viewer_events.wire`` installs on
  the agent (``reasoning_callback``, ``_print_fn``), as ``TurnRunner`` installs them for a Desktop turn;
- ``reasoning.available`` and the ``moa.*`` events through ``local_viewer_events.publish_progress``,
  the agent's progress callback, with the kwargs ``agent/moa_loop.py``'s relay passes;
- ``status.update`` for a compaction through ``TurnRunner._status_callback_sync`` with the agent's own
  ``COMPACTION_STATUS`` and ``COMPACTION_DONE_STATUS``, and ``notification.show`` / ``.clear``
  through ``_local_notice_callback_sync`` / ``_local_notice_clear_callback_sync`` with an ``AgentNotice``;
- ``tool.complete.image_path``, read by ``complete_fields`` from a real PNG in /tmp/hermes-proto-work;
- the goal verdict while idle, published by ``GatewayRunner._send_goal_status_notice`` for a local
  source after the turn has ended.

Scripted in ``says`` as well: the reasoning text, the MoA reference answers, and the result of
``vision_analyze``, which needs a vision provider. A step's ``result`` replaces the tool run.

Real in ``asks``: every request frame, every ``request.cancel``, and the ``connection.request`` and
``connection.update`` events. Each request goes out through ``gateway/session_server_requests._ask``
to the story's socket, which answers it with a JSON-RPC response frame through
``AuthorityConnection.dispatch`` (``_resolve_response``), with ``clarify.lock`` or with
``connection.respond``, as a viewer does. What asks is the callback the turn's own scope installs:
- ``sudo``: ``sudo_prompt_scope``, then the terminal tool's ``_prompt_for_sudo_password``;
- ``secret``: ``secret_prompt_scope``, then the skills tool's ``_capture_required_environment_variables``;
- ``vault.code``: ``vault_prompt_scope``, then the vault's own code-prompt callback. The second viewer is
  a second ``AuthorityConnection`` attached to the session;
- the ``clarify`` batch: the real ``clarify`` tool over ``ask_clarify_batch``;
- the card: a ``ConnectionOperation`` opened in ``tools/connectors/live`` and published by the
  ``connection_callback`` that ``local_desktop_ui.wire`` installs. ``connection.respond`` runs
  ``tools.connectors.run.respond``, and the operation's own change hook publishes each update;
- ``theme.pick``: the ``theme_callback`` that ``local_desktop_ui.wire`` installs;
- the plugin choice: ``hermes_cli.plugin_choices.ask_choice`` under ``viewer_choices``, the asker
  ``command.dispatch`` binds around a plugin command's handler.

Scripted in ``asks``: the tool around each request. No ``sudo`` runs, no skill is loaded, no site is
opened and no connector directory is read: each step's tool result is written by the story, except
the ``clarify`` tool's, which is real. The plugin command itself is not dispatched, so the fixture
has no ``command.dispatch`` call held open around its choice. The typed values are the story's.

Not emitted, because only a provider produces them: ``thinking.delta`` (spinner text while a request
is in flight) and ``session.usage`` (token counts).
"""
import asyncio
import base64
import json
import logging
import os
import random
import re
import shutil
import subprocess
import sys
import threading
import struct
import time
import uuid
import zlib
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

WORK = "/tmp/hermes-proto-work"
HOME = "/tmp/hermes-proto-home"
USER = "highwing-fixture"
SHOT = f"{WORK}/dashboard.png"
CHART_URL = "https://example.com/signups-chart.png"


@dataclass(frozen=True)
class Story:
    request: str
    steps: list
    out: str
    seed: int
    # The work dir's files before the turn, by path under WORK.
    files: dict
    # The folder the story's rm -rf asks to delete, or None when it deletes nothing.
    doomed: str | None
    # The recorded answer to the approval. None ends the fixture at ``approval.request``.
    answer: str | None
    # False for a turn that never asks for an approval. The fixture then ends with the turn's ``stored`` rows.
    approves: bool = True
    # True when the story's turn takes a screenshot, so the script registers the scripted tool.
    screenshots: bool = False
    viewer: bool = False
    after: object = None
    # Files under WORK that a tool names as its image. The header's ``media`` carries their bytes, so a replay draws them.
    shows: tuple = ()
    # What the story's viewer does with each request, in the order Hermes asks: (request method or event type, act).
    asks: tuple = ()


NOTES = "# Todo\n\n- [ ] sketch the chat view\n- [ ] wire the gateway socket\n- [ ] review screenshots\n"


def final_words() -> str:
    notes = Path(WORK, "notes.md").read_text()
    return ("Done. I created `notes.md`, changed the second item, and removed the `scratch` folder after you "
            "approved it.\n\n```markdown\n" + notes + "```")


def pin_listing_times():
    for name in ("scratch/old.txt", "scratch", "notes.md", "."):
        os.utime(os.path.join(WORK, name), (1767268800, 1767268800))


ERRAND = Story(
    request=("In /tmp/hermes-proto-work: make notes.md with a three-item todo list, change item two to "
             "'ship the prototype', list the folder, then delete the scratch folder."),
    steps=[
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
    ],
    out="errand.jsonl", seed=20261121, files={"scratch/old.txt": "tmp\n"}, doomed=f"{WORK}/scratch", answer="once")

APP = f"{WORK}/app"


def read(path):
    return ("read_file", {"path": f"{APP}/{path}"})


def edit(path, old, new):
    return ("patch", {"mode": "replace", "path": f"{APP}/{path}", "old_string": old, "new_string": new})


# The thread outgrows the window before the first terminal call, the ``wc`` stays the live end for 3 s,
# steps keep arriving after it, and the fixture stops while the turn waits on an approval.
# Each search matches in at most one file: ripgrep does not promise an order across files.
LONG_TURN = Story(
    request=("In /tmp/hermes-proto-work/app: rename the greet helper to welcome everywhere, start a changelog, "
             "count the lines in each file, bump the version to 0.2.0, then delete the build folder."),
    steps=[
        {"say": "I'll start with the README to see what the project does.", "call": read("README.md"), "ms": 14},
        {"say": "Now the helper itself.", "call": read("src/util.py"), "ms": 11},
        {"say": "And the entry point that calls it.", "call": read("src/main.py"), "ms": 12},
        {"say": "Checking whether the tests use it too.",
         "call": ("search_files", {"pattern": "greet", "path": f"{APP}/tests"}), "ms": 36},
        {"say": "They do, so I'll read that test.", "call": read("tests/test_util.py"), "ms": 10},
        {"say": "Renaming the function first.", "call": edit("src/util.py", "def greet(", "def welcome("), "ms": 19},
        {"say": "Then the import in main.py.",
         "call": edit("src/main.py", "from util import greet", "from util import welcome"), "ms": 17},
        {"say": "And the call that prints the greeting.",
         "call": edit("src/main.py", "print(greet(", "print(welcome("), "ms": 16},
        {"say": "Now the test's import.",
         "call": edit("tests/test_util.py", "from util import greet", "from util import welcome"), "ms": 18},
        {"say": "And the test itself.",
         "call": edit("tests/test_util.py", "def test_greet():\n    assert greet(",
                      "def test_welcome():\n    assert welcome("), "ms": 21},
        {"say": "Making sure no call to greet is left.",
         "call": ("search_files", {"pattern": r"greet\(", "path": APP}), "ms": 41},
        {"say": "Reading the config for the current version.", "call": read("config.toml"), "ms": 9},
        {"say": "Starting a changelog for the rename.",
         "call": ("write_file", {"path": f"{APP}/CHANGELOG.md",
                                 "content": "# Changelog\n\n## Unreleased\n\n- Renamed `greet` to `welcome`.\n"}),
         "ms": 13},
        {"say": "Mentioning the new name in the README.",
         "call": edit("README.md", "A tiny greeter.", "A tiny greeter. Its helper is `welcome`."), "ms": 15},
        {"say": "Counting the lines in each file.",
         "call": ("terminal", {"command": f"cd {APP} && wc -l README.md CHANGELOG.md config.toml src/*.py tests/*.py"}),
         "ms": 3000},
        {"say": "Bumping the version for the release.",
         "call": edit("config.toml", 'version = "0.1.0"', 'version = "0.2.0"'), "ms": 240},
        {"say": "Checking that only the config has the new version.",
         "call": ("search_files", {"pattern": r"0\.2\.0", "path": APP}), "ms": 260},
        {"say": "Putting the version in the changelog heading.",
         "call": edit("CHANGELOG.md", "## Unreleased", "## 0.2.0"), "ms": 230},
        {"say": "Reading the changelog back.", "call": read("CHANGELOG.md"), "ms": 250},
        {"say": "Last, removing the stale build folder.", "pause": 1500,
         "call": ("terminal", {"command": f"rm -rf {APP}/build"}), "ms": 90},
        {"say": "I left the build folder in place.", "call": None},
    ],
    out="long-turn.jsonl", seed=20261122,
    files={
        "app/README.md": "# app\n\nA tiny greeter. `python src/main.py NAME` prints a greeting.\n",
        "app/config.toml": '[app]\nname = "app"\nversion = "0.1.0"\n',
        "app/src/util.py": 'def greet(name):\n    return f"Hello, {name}!"\n',
        "app/src/main.py": "import sys\n\nfrom util import greet\n\nprint(greet(sys.argv[1]))\n",
        "app/tests/test_util.py": 'from util import greet\n\n\ndef test_greet():\n    assert greet("Ada") == "Hello, Ada!"\n',
        "app/build/app.pyz": "stale\n",
    },
    doomed=f"{APP}/build", answer=None)

MARKDOWN_REPLY = """Here is the plan for notes.md.

1. Back up notes.md
2. Rename the heading

## Details

The [style guide](https://example.com/style-guide) says to keep headings short.

| File | Lines | Changed |
| --- | --- | --- |
| notes.md | 42 | yes |
| todo.md | 7 | no |

Run this first:

```sh
cp notes.md notes.md.bak
```

```ts
// Keep each backup for a week.
const days: number = 7
function backupName(file: string): string {
  return file + ".bak"
}
```"""

MARKDOWN = Story(
    request="Give me a short plan for backing up notes.md and renaming its heading.",
    steps=[{"say": MARKDOWN_REPLY, "call": None}],
    out="markdown.jsonl", seed=20261123, files={}, doomed=None, answer=None, approves=False)

IMAGES = Story(
    request="Take a screenshot of the dashboard and chart last week's signups.",
    steps=[
        {"say": "I'll capture the dashboard first.", "call": ("screenshot", {}), "ms": 420},
        {"say": f"Here is the chart you asked for.\n\n![a chart]({CHART_URL})", "call": None},
    ],
    out="images.jsonl", seed=20261124, files={}, doomed=None, answer=None, approves=False, screenshots=True)

SITE = f"{WORK}/site"
DEV_URL = "http://localhost:5173/"
PAGE = (Path(__file__).resolve().parent / "preview/index.html").read_text()
BUILD_PAGE = [
    {"say": "I'll write the page first.", "call": ("write_file", {"path": f"{SITE}/index.html", "content": PAGE}), "ms": 14},
    {"say": "Opening it beside the chat.",
     "call": ("desktop_preview", {"action": "open", "url": DEV_URL, "label": "demo"}), "ms": 6},
]

PREVIEW = Story(
    request="Build a small demo page in /tmp/hermes-proto-work/site and show it to me.",
    steps=[*BUILD_PAGE,
           {"say": (f"Preview ready at [the demo]({DEV_URL}). The page is saved as `{SITE}/index.html`, and it "
                    "replaces [the old docs](http://unreachable.invalid/)."), "call": None}],
    out="preview.jsonl", seed=20261125, files={}, doomed=None, answer=None, approves=False)

PREVIEW_CLOSE = Story(
    request="Show me the demo page in /tmp/hermes-proto-work/site, then close it.",
    steps=[*BUILD_PAGE,
           {"say": "Closing the preview now.", "call": ("desktop_preview", {"action": "close"}), "ms": 6, "pause": 2000},
           {"say": "Closed.", "call": None}],
    out="preview-close.jsonl", seed=20261126, files={}, doomed=None, answer=None, approves=False)

REPORTS = f"{WORK}/reports"
FILES = Path(__file__).resolve().parent / "preview-files"


def pdf(pages):
    """A text-only PDF with one line of Helvetica on each page, and a correct xref table."""
    count = len(pages)
    objects = ["<< /Type /Catalog /Pages 2 0 R >>",
               f"<< /Type /Pages /Kids [{' '.join(f'{3 + 2 * i} 0 R' for i in range(count))}] /Count {count} >>"]
    for i, text in enumerate(pages):
        stream = f"BT /F1 28 Tf 72 700 Td ({text}) Tj ET"
        objects.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
                       f"/Resources << /Font << /F1 {3 + 2 * count} 0 R >> >> /Contents {4 + 2 * i} 0 R >>")
        objects.append(f"<< /Length {len(stream)} >>\nstream\n{stream}\nendstream")
    objects.append("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    out, offsets = "%PDF-1.4\n", []
    for number, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n{body}\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n" + "".join(f"{o:010d} 00000 n \n" for o in offsets)
    return out + f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n"


def rows(count, width=0):
    return "id,customer,total\n" + "".join(f"{i},customer-{i:06d}{'x' * width},{i % 997}\n" for i in range(1, count + 1))


PREVIEW_FILES = Story(
    request="Export this quarter's sales as CSV and PDF into /tmp/hermes-proto-work/reports, and tidy the old exports.",
    steps=[
        {"say": "I'll write the CSV first.",
         "call": ("write_file", {"path": f"{REPORTS}/report.csv", "content": (FILES / "report.csv").read_text()}), "ms": 9},
        {"say": "", "call": ("write_file", {"path": f"{REPORTS}/report.pdf",
                                            "content": pdf(["Quarterly report", "Page two"])}), "ms": 11},
        {"say": "", "call": ("write_file", {"path": f"{REPORTS}/quoted.csv", "content": (FILES / "quoted.csv").read_text()}), "ms": 8},
        {"say": "", "call": ("write_file", {"path": f"{REPORTS}/scan.pdf",
                                            "content": "This scan was saved as plain text, not as a PDF.\n"}), "ms": 7},
        {"say": "Now the old exports.",
         "call": ("patch", {"mode": "replace", "path": f"{REPORTS}/big.csv",
                            "old_string": "id,customer,total", "new_string": "id,customer,amount"}), "ms": 40},
        {"say": "", "call": ("patch", {"mode": "replace", "path": f"{REPORTS}/huge.csv",
                                       "old_string": "id,customer,total", "new_string": "id,customer,amount"}), "ms": 90},
        {"say": "Done. The exports are in `reports`: `report.csv` and `report.pdf`, with `big.csv` and `huge.csv` renamed "
                "to use `amount`.", "call": None},
    ],
    out="preview-files.jsonl", seed=20261127,
    files={"reports/big.csv": rows(20000), "reports/huge.csv": rows(200000, 40)},
    doomed=None, answer=None, approves=False)


def tiny_png() -> bytes:
    import struct
    import zlib

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    rows = b"".join(b"\x00" + b"\x3c\x8c\x5a" * 2 for _ in range(2))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 2, 2, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b""))


def moa_round(turn, agent):
    """One MoA fan-out as ``agent/moa_loop.py`` relays it to the agent's progress callback."""
    progress = local_viewer_events.publish_progress
    for done in (1, 2):
        CLOCK.tick(150)
        progress(turn, "moa.progress", "advisor", None, {"moa_refs_done": done, "moa_refs_total": 2})
    for index, (label, text) in enumerate([("fast-small", "It is a bar chart of three weekly totals."),
                                           ("careful-large", "Three bars: 4, 7 and 5. The second week peaks.")], start=1):
        progress(turn, "moa.reference", label, text, {"moa_index": index, "moa_count": 2})
    progress(turn, "moa.phase", "judge-large", None, {"moa_phase": "aggregator", "moa_refs_done": 2, "moa_refs_total": 2})
    progress(turn, "moa.aggregating", "judge-large", None, {"moa_ref_count": 2})


def compaction_and_notice(turn, agent):
    from agent.conversation_compression import COMPACTION_DONE_STATUS, COMPACTION_STATUS
    from agent.credits_tracker import AgentNotice
    turn._status_callback_sync("lifecycle", COMPACTION_STATUS)
    CLOCK.tick(900)
    turn._status_callback_sync("compacted", COMPACTION_DONE_STATUS)
    agent._print_fn("Subagent finished: 3 files checked.")
    turn._local_notice_callback_sync(AgentNotice(text="Credits are running low.", level="warn", kind="sticky",
                                                 key="credits.low", id="credits.low"))


def clear_notice(turn, agent):
    turn._local_notice_clear_callback_sync("credits.low")


async def goal_verdict(runner, live):
    from gateway.run_goals import GatewayGoalsMixin
    await GatewayGoalsMixin._send_goal_status_notice(
        runner, live.source, "✓ Goal achieved: the chart was read and the scratch folder is gone.")


SAYS = Story(
    request="In /tmp/hermes-proto-work: tell me what chart.png shows, then delete the scratch folder.",
    steps=[
        {"hermes": [moa_round],
         "reasoning": ("stream", ["The user wants the chart read first, ", "then the scratch folder removed. ",
                                  "The reference models have read it."]),
         "say": "The models agree it is a bar chart. Looking at it myself.",
         "call": ("vision_analyze", {"image_url": f"{WORK}/chart.png", "question": "What does this chart show?"}),
         "result": json.dumps({"success": True, "analysis": "A bar chart of three weekly totals: 4, 7 and 5."}),
         "ms": 420},
        {"hermes": [compaction_and_notice], "reasoning": ("whole", ["The chart is read. Only the scratch folder is left."]),
         "say": "It shows three weekly totals. Now removing the scratch folder.",
         "call": ("terminal", {"command": f"rm -rf {WORK}/scratch"}), "ms": 95},
        {"hermes": [clear_notice], "say": "Done. The chart shows weekly totals of 4, 7 and 5, and the scratch folder is gone.",
         "call": None},
    ],
    out="says.jsonl", seed=20261124, files={"chart.png": tiny_png(), "scratch/old.txt": "tmp\n"},
    doomed=f"{WORK}/scratch", answer="once", viewer=True, after=goal_verdict, shows=("chart.png",))

SUDO_COMMAND = "sudo apt-get install -y jq"
BATCH = [{"question": "Which environment should I deploy to?", "choices": ["staging", "production"]},
         {"question": "Which regions?", "choices": ["eu-west", "us-east", "ap-south"], "multi_select": True}]
NO_PICKER = {"code": -32601, "message": "Highwing has no part of its window to answer this with."}
MASKED = "•••"


def with_window(turn, agent, ask):
    """Run *ask* with the window bridges ``TurnRunner`` installs for a local viewer's turn."""
    from gateway import local_desktop_ui
    token = local_desktop_ui.wire(turn, agent)
    try:
        return ask()
    finally:
        local_desktop_ui.release(token)


def sudo_password(turn, agent):
    from gateway.session_sudo_prompt import sudo_prompt_scope
    from tools.terminal_tool_sudo import _prompt_for_sudo_password
    with sudo_prompt_scope(turn, agent):
        typed = _prompt_for_sudo_password(command=SUDO_COMMAND)
    return json.dumps({"output": "jq is already the newest version (1.7.1-3)." if typed else "sudo: a password is required",
                       "exit_code": 0 if typed else 1, "error": None, "cwd": WORK})


def skill_secret(turn, agent):
    from gateway.session_secret_prompt import secret_prompt_scope
    from tools.skills_tool_setup import _capture_required_environment_variables
    with secret_prompt_scope(turn, agent):
        captured = _capture_required_environment_variables("gif-search", [
            {"name": "TENOR_API_KEY", "prompt": "Tenor API key", "help": "https://developers.google.com/tenor"}])
    return json.dumps({"success": True, "name": "gif-search", "setup_needed": bool(captured["missing_names"]),
                       "missing_required_environment_variables": captured["missing_names"]})


def vault_code(turn, agent):
    from agent.vault_backends import unlock
    from gateway.session_vault_prompt import vault_prompt_scope
    with vault_prompt_scope(turn, agent):
        code = unlock.get_code_prompt_callback()("example.com", "the 6-digit code from your authenticator app")
    return json.dumps({"success": bool(code), "url": "https://example.com/account"})


def clarify_batch(turn, agent):
    from gateway.session_clarify_batch import ask_clarify_batch
    from tools.clarify_tool import clarify_tool
    return clarify_tool(BATCH, callback=lambda questions: ask_clarify_batch(turn, questions))


def connector_card(turn, agent):
    from tools.connectors import live as open_operations
    from tools.connectors.operation import ConnectionOperation, Target

    def ask():
        # ``created_at`` defaults to the clock the module bound at import, before the story's virtual one.
        operation = ConnectionOperation(session_key=turn._ctx.session_key, created_at=time.time(), targets=[Target(
            name="github", kind="connector", action="connect", connect_url="https://example.com/connect/github",
            instructions="Sign in to GitHub in your browser, then come back here.")])
        open_operations.open(operation)
        agent.connection_callback(operation.request_payload())
        while not operation.settled:
            operation.wake.wait(0.05)
        return json.dumps(operation.result())
    return with_window(turn, agent, ask)


def theme_picker(turn, agent):
    return with_window(turn, agent, lambda: json.dumps(agent.theme_callback({"picker": "accent"})))


async def plugin_choice(runner, live):
    from gateway.plugin_command_choice import viewer_choices
    from hermes_cli.plugin_choices import ask_choice
    session_id = next(sid for sid, held in runner.session_authority.sessions.items() if held is live)

    def ask():
        with viewer_choices(live, session_id):
            return ask_choice("Which notes should /tidy clean up?", ["Today's", "This week's", "All of them"])
    await asyncio.to_thread(ask)


def typed(value):
    """Answer with a value. The fixture keeps ``MASKED`` in its place."""
    async def act(viewer, frame):
        await viewer.answer(frame["id"], {"result": {"value": value}}, {"result": {"value": MASKED}})
    return act


async def skipped(viewer, frame):
    await viewer.answer(frame["id"], {"result": {"value": ""}})


async def declined(viewer, frame):
    await viewer.answer(frame["id"], {"error": NO_PICKER})


async def elsewhere(viewer, frame):
    """A second viewer of the chat answers first."""
    other = AuthorityConnection(viewer.authority, SimpleNamespace(write=lambda obj: True), {"user_id": USER, "native_bootstrap": True})
    await viewer.call(other, "session.resume", {"session_id": viewer.session_id})
    await other.dispatch({"jsonrpc": "2.0", "id": frame["id"], "result": {"value": "424242"}})


def locks(*answers):
    async def act(viewer, frame):
        for question, answer in zip(frame["params"]["questions"], answers):
            CLOCK.tick(900)
            await viewer.story_call("clarify.lock", {"request_id": frame["id"], "question_id": question["qid"], "answer": answer})
    return act


async def skip_target(viewer, frame):
    card = frame["params"]["payload"]
    await viewer.story_call("connection.respond", {
        "owner": {"type": "session", "session_id": viewer.session_id}, "op_id": card["op_id"],
        "result": {"targets": [{"name": card["targets"][0]["name"], "status": "skipped"}]}})


ASKS = Story(
    request="Install jq, find me a celebration gif, check my example.com account, then deploy the notes site.",
    steps=[
        {"say": "I'll install jq first. That needs your sudo password.",
         "call": ("terminal", {"command": SUDO_COMMAND}), "during": [sudo_password], "ms": 2400},
        {"say": "Now the gif. The gif-search skill needs a Tenor key.",
         "call": ("skill_view", {"name": "gif-search"}), "during": [skill_secret], "ms": 40},
        {"say": "No key, so I'll skip the gif. Signing in to example.com.",
         "call": ("browser_navigate", {"url": "https://example.com/account"}), "during": [vault_code], "ms": 1800},
        {"say": "You're signed in. Before I deploy, two questions.",
         "call": ("clarify", {"questions": BATCH}), "during": [clarify_batch], "ms": 30},
        {"say": "Production in two regions. The deploy needs GitHub connected.",
         "call": ("manage_connections", {"action": "connect", "connectors": ["github"]}), "during": [connector_card], "ms": 60},
        {"say": "Skipped, so I'll deploy from the local checkout. Offering an accent colour while it runs.",
         "call": ("set_theme", {"picker": "accent"}), "during": [theme_picker], "ms": 25},
        {"say": "Done. jq is installed, the gif was skipped for want of a Tenor key, and the notes site is deployed to production.",
         "call": None},
    ],
    out="asks.jsonl", seed=20261125, files={}, doomed=None, answer=None, approves=False, after=plugin_choice,
    asks=(("sudo", typed("correct horse battery staple")), ("secret", skipped), ("vault.code", elsewhere),
          ("clarify", locks("production", json.dumps(["eu-west (Recommended)", "us-east"], separators=(",", ":")))), ("connection.request", skip_target),
          ("theme.pick", declined), ("clarify", locks("This week's"))))

STORIES = {"errand": ERRAND, "long-turn": LONG_TURN, "markdown": MARKDOWN, "images": IMAGES, "preview": PREVIEW,
           "preview-close": PREVIEW_CLOSE, "preview-files": PREVIEW_FILES, "says": SAYS, "asks": ASKS}
NAME = sys.argv[1] if len(sys.argv) > 1 else "errand"
if NAME not in STORIES:
    sys.exit(f"no story named {NAME!r}; pick one of: {', '.join(STORIES)}")
TALE = STORIES[NAME]
REQUEST, STORY = TALE.request, TALE.steps

_rng = random.Random(TALE.seed)
# Patched before Hermes is imported, so modules that bind ``from uuid import uuid4`` get it too.
uuid.uuid4 = lambda: uuid.UUID(int=_rng.getrandbits(128), version=4)


_version = subprocess.run(["hermes", "--version"], capture_output=True, text=True, check=True).stdout
_found = re.search(r"^Hermes Agent v(\S+)", _version, re.M), re.search(r"^Install directory:\s*(.+)$", _version, re.M)
if not all(_found):
    sys.exit(f"hermes --version printed no version or no 'Install directory:' line:\n{_version}")
HERMES_VERSION, HERMES_DIR = _found[0].group(1), _found[1].group(1).strip()
sys.path.insert(0, HERMES_DIR)
import hermes_bootstrap  # noqa: E402,F401

OUT = Path(__file__).resolve().parent / TALE.out

for path in (WORK, HOME):
    shutil.rmtree(path, ignore_errors=True)
for name, content in TALE.files.items():
    Path(WORK, name).parent.mkdir(parents=True, exist_ok=True)
    if isinstance(content, bytes):
        Path(WORK, name).write_bytes(content)
    else:
        Path(WORK, name).write_text(content)
os.makedirs(HOME)
# After the bootstrap: pointed at a new home first, it would prepare a whole runtime there.
os.environ["HERMES_HOME"] = HOME

import model_tools  # noqa: E402
from gateway import local_desktop_ui, local_viewer_events, session_finite, session_lifecycle  # noqa: E402
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


def png(width, height, paint):
    """A stdlib PNG: ``paint(x, y)`` returns the (r, g, b) of each pixel."""
    rows = b"".join(b"\0" + bytes(c for x in range(width) for c in paint(x, y)) for y in range(height))

    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b""))


def inside(x, y, box):
    left, top, right, bottom = box
    return left <= x < right and top <= y < bottom


def layers(layout, background):
    """A painter from a back-to-front list of (box, color)."""
    def paint(x, y):
        color = background
        for box, fill in layout:
            if inside(x, y, box):
                color = fill
        return color
    return paint


def dashboard_png():
    ink, card, accent = (31, 41, 55), (255, 255, 255), (59, 130, 246)
    layout = [((0, 0, 640, 48), ink), ((16, 14, 120, 34), (156, 163, 175)), ((560, 12, 628, 36), accent),
              ((0, 48, 140, 400), (243, 244, 246))]
    layout += [((12, 64 + 36 * i, 128, 88 + 36 * i), accent if i == 0 else (209, 213, 219)) for i in range(5)]
    for i, tint in enumerate([accent, (16, 185, 129), (245, 158, 11), (239, 68, 68)]):
        left = 156 + 120 * i
        layout += [((left, 64, left + 108, 136), card), ((left, 64, left + 6, 136), tint),
                   ((left + 18, 80, left + 76, 90), (156, 163, 175)), ((left + 18, 104, left + 88, 124), ink)]
    layout += [((156, 152, 628, 384), card), ((176, 168, 300, 178), (156, 163, 175))]
    layout += [((196 + 52 * i, 368 - h, 232 + 52 * i, 368), accent)
               for i, h in enumerate([60, 90, 70, 120, 100, 150, 130, 170])]
    layout += [((176, 368, 612, 370), (209, 213, 219))]
    return png(640, 400, layers(layout, (229, 231, 235)))


def chart_png():
    ink = (31, 41, 55)
    layout = [((48, 24, 50, 280), ink), ((48, 278, 616, 280), ink)]
    layout += [((48, 24 + 50 * i, 616, 25 + 50 * i), (229, 231, 235)) for i in range(5)]
    for i, h in enumerate([80, 110, 95, 150, 135, 190, 165]):
        left = 72 + 78 * i
        layout.append(((left, 278 - h, left + 48, 278), (59, 130, 246) if i < 6 else (16, 185, 129)))
    return png(640, 320, layers(layout, (249, 250, 251)))


def take_screenshot(args, **kwargs):
    Path(SHOT).parent.mkdir(parents=True, exist_ok=True)
    Path(SHOT).write_bytes(dashboard_png())
    return json.dumps({"image_path": SHOT, "width": 640, "height": 400})


if TALE.screenshots:
    from tools.registry import registry  # noqa: E402
    registry.register(
        "screenshot", "fixture", {"name": "screenshot", "description": "Take a screenshot of the dashboard.",
                                  "parameters": {"type": "object", "properties": {}}},
        lambda args, **kwargs: take_screenshot(args))

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
STORY_START = 1795251600
time.time = lambda: STORY_START + CLOCK.now() / 1000
# The creation time of the session's routing entry and row (``session_local.stage_local_session``).
session_lifecycle._now = lambda: datetime.fromtimestamp(time.time())


def wire(frame):
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
        if not self.recording:
            return True
        self.written.append(wire(obj))
        if obj.get("method") != "event" and "id" in obj:
            # A server request is written to the session's sockets and never published, so no observer sees it.
            CLOCK.tick(4)
            self.steps.append({"at": CLOCK.now(), "push": wire(obj)})
            self.loop.call_soon_threadsafe(self.seen.put_nowait, obj)
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

    async def asked(self, name):
        """The next request frame of method *name*, or the next event of that type."""
        while True:
            frame = await self.seen.get()
            if name in (frame.get("method"), frame.get("params", {}).get("type")):
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
    window = local_desktop_ui.wire(turn, agent)
    sinks = local_viewer_events.wire(turn, agent) if TALE.viewer else None
    needs_break = False
    streamed = False
    try:
        for iteration, step in enumerate(STORY, start=1):
            CLOCK.tick(step.get("pause", 0))
            turn._ctx._step_callback_sync(iteration, [])
            for beat in step.get("hermes", []):
                beat(turn, agent)
            # The agent keeps the reasoning on the assistant message.
            how, chunks = step.get("reasoning", ("stream", []))
            if how == "whole":
                local_viewer_events.publish_progress(turn, "reasoning.available", "_thinking", "".join(chunks), None)
            for chunk in chunks if how == "stream" else []:
                CLOCK.tick(20)
                agent.reasoning_callback(chunk)
            thought = {"reasoning": "".join(chunks)} if chunks else {}
            words = step["say"]() if callable(step["say"]) else step["say"]
            if words:
                text = ("\n\n" + words) if needs_break else words
                needs_break = False
                for i in range(0, len(text), 24):
                    CLOCK.tick(30)
                    turn._publish_execution("message.delta", {"text": text[i:i + 24]})
                streamed = True
            if step["call"] is None:
                messages.append({"role": "assistant", "content": words or "", **thought})
                break
            name, args = step["call"]
            call_id = call_ids[iteration - 1]
            CLOCK.tick(60)
            turn._publish_execution("tool.generating", {"name": name})
            messages.append({"role": "assistant", "content": words or "", **thought, "tool_calls": [
                {"id": call_id, "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}]})
            agent._flush_messages_to_session_db(messages, history)
            # ``turn_tool_round.py``: the open text box closes before the tool lines.
            turn._publish_execution("message.delta", {"text": None})
            turn.combined_tool_start_callback(call_id, name, args)
            if "stage" in step:
                step["stage"]()
            # What the tool asks its viewers while it runs. The last one answers the tool's result.
            asked = [ask(turn, agent) for ask in step.get("during", [])]
            result = asked[-1] if asked else step["result"] if "result" in step else model_tools.handle_function_call(
                name, args, task_id=session_id, tool_call_id=call_id, session_id=session_id)
            CLOCK.tick(step["ms"])
            turn.combined_tool_complete_callback(call_id, name, args, result)
            messages.append({"role": "tool", "tool_call_id": call_id, "content": result})
            agent._flush_messages_to_session_db(messages, history)
            needs_break = streamed
    finally:
        local_viewer_events.restore(agent, sinks)
        local_desktop_ui.release(window)
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
        # The status fields are what ``_status_callback_sync`` and the notice sinks read; a local turn's
        # status lines go to the event stream and never reach the adapter they check for.
        turn._ctx = SimpleNamespace(
            source=live.source, session_id=ref.session_id, session_key=live.route,
            _loop_for_step=asyncio.get_running_loop(), _run_still_current=lambda: True,
            _voice_ack_guild=[None], _native_slack_task_cards=False, progress_mode=None, agent_holder=[None],
            _hooks_ref=SimpleNamespace(loaded_hooks=[]), progress_queue=None,
            mute_notification_reply=False, _status_adapter=SimpleNamespace(), user_config={},
            run_generation=row["generation"], _status_chat_id=None, _status_thread_metadata=None, _cleanup_progress=False)
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

    controls = {}
    if TALE.viewer:
        await call(socket, "config.set", {"session_id": session_id, "key": "show_reasoning", "value": "on"})
        shown = (await call(socket, "config.get", {"session_id": session_id, "key": "show_reasoning"}))["result"]
        controls[shown["key"]] = shown["value"]

    async def answer(request_id, frame, kept=None):
        """The viewer's response frame to a server request. It gets no reply. *kept* is what the fixture records of it."""
        recorder.steps.append({"at": CLOCK.now(), "answer": request_id, **(kept or frame)})
        await socket.dispatch({"jsonrpc": "2.0", "id": request_id, **frame})

    viewer = SimpleNamespace(authority=authority, session_id=session_id, call=call, story_call=story_call, answer=answer)

    async def attend():
        for name, act in TALE.asks:
            frame = wire(await recorder.asked(name))
            CLOCK.tick(1500)
            await act(viewer, frame)

    recorder.recording = True
    # A viewer that takes the clarify tool's questions as one request says so with each message.
    await story_call("prompt.submit", {"session_id": session_id, "text": REQUEST, "input_id": "input_" + uuid.uuid4().hex[:16],
                                       **({"clarify_batch": True} if TALE.asks else {})})
    if TALE.approves:
        try:
            request = await asyncio.wait_for(recorder.push_of("approval.request"), 60)
        except TimeoutError:
            sys.exit("the gateway never asked to approve the rm -rf")
        prompt = request["params"]["payload"]
        answer_to = {"session_id": session_id, "execution_generation": prompt["execution_generation"],
                     "prompt_id": prompt["prompt_id"]}

    async def stop_recording():
        pushes = [step["push"] for step in recorder.steps if "push" in step]
        for _ in range(100):
            if len(recorder.written) >= len(pushes):
                break
            await asyncio.sleep(0.05)
        recorder.recording = False
        if recorder.written != pushes:
            sys.exit("the socket received other frames than the session published")
        return pushes

    async def record_stored():
        reader = AuthorityConnection(authority, SimpleNamespace(write=lambda obj: True), {"user_id": USER})
        snapshot = (await call(reader, "session.resume", {"session_id": session_id, "display_projection": True}))["result"]
        CLOCK.tick(4)
        recorder.steps.append({"at": CLOCK.now(), "stored": snapshot["display_messages"]})

    if not TALE.approves:
        attending = asyncio.create_task(attend())
        await live.task
        if TALE.after is not None:
            CLOCK.tick(600)
            await TALE.after(runner, live)
        await attending
        pushes = await stop_recording()
        await record_stored()
    elif TALE.answer is None:
        pushes = await stop_recording()
        await call(socket, "approval.respond", {**answer_to, "choice": "deny"})
        await live.task
    else:
        CLOCK.tick(1500)
        await story_call("approval.respond", {**answer_to, "choice": TALE.answer})
        await live.task
        if TALE.after is not None:
            CLOCK.tick(600)
            await TALE.after(runner, live)
        pushes = await stop_recording()
        await record_stored()

    header = {"fixture": 1, "hermes": HERMES_VERSION, "source": "generated", "sessionId": session_id,
              "describe": describe, "list": listing, "stored": created["messages"], **({"controls": controls} if controls else {})}
    media = {f"{WORK}/{name}": Path(WORK, name).read_bytes() for name in TALE.shows}
    if TALE.screenshots:
        media |= {SHOT: Path(SHOT).read_bytes(), CHART_URL: chart_png()}
    if media:
        header["media"] = {path: base64.b64encode(data).decode() for path, data in media.items()}
    with OUT.open("w") as out:
        for line in [header, *recorder.steps]:
            out.write(json.dumps(line, ensure_ascii=False) + "\n")
    db.close()
    print(f"wrote {OUT}: {len(pushes)} pushes, {len(recorder.steps) - len(pushes)} other steps", file=sys.stderr)
    if TALE.doomed is not None and os.path.exists(TALE.doomed) != (TALE.answer is None):
        sys.exit(f"after the answer to the rm -rf, {TALE.doomed} {'is gone' if TALE.answer is None else 'is still there'}")


asyncio.run(main())
