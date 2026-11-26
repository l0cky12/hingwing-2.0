"""Write fixtures/profiles/bench.json, the roster the switch bench times: Emu, the default bot, whose Bot Chat is the
story, Atlas, whose Bot Chat holds 160 rows of markdown (about 300 KB, as a real main chat does), Birch, with a short
Bot Chat and 40 other chats, and Cedar, with no Bot Chat and 3 chats. All text is invented filler.

Run with any Python 3:  python3 fixtures/make_bench_fixture.py
"""
import json
import random
from pathlib import Path

HERE = Path(__file__).resolve().parent / "profiles"
EMU = next(row for row in json.loads((HERE / "chats.json").read_text())["profiles"] if row["is_default"])
NOW = 1795250000
ATLAS_LAST = "Atlas closing note: the ledger reconciles to the penny."

WORDS = (
    "ledger invoice river garden lantern copper harbor meadow quarry orchard signal pocket ribbon timber canvas marble "
    "anchor beacon cellar falcon glacier hollow island jasper kettle lagoon mortar nickel oyster pebble quiver rafter "
    "saddle tunnel umber velvet willow yonder zephyr basket candle dagger ember fennel goblet hazel indigo juniper"
).split()
CODE = [
    ("python", "def total(rows):\n    return sum(row.amount for row in rows if not row.void)\n\nprint(total(load('ledger.csv')))"),
    ("ts", "export function due(invoices: Invoice[], today: Date): Invoice[] {\n  return invoices.filter(i => i.dueAt <= today && !i.paid)\n}"),
    ("bash", "find ~/Downloads -name '*.dmg' -mtime +30 -print0 | xargs -0 rm -v\nls -lh ~/Downloads | head -20"),
    ("json", '{\n  "ledger": "2026-q3",\n  "accounts": ["operating", "payroll", "reserve"],\n  "reconciled": true\n}'),
]


def sentence(rng, low=8, high=20):
    words = [rng.choice(WORDS) for _ in range(rng.randint(low, high))]
    return " ".join(words).capitalize() + "."


def paragraph(rng):
    return " ".join(sentence(rng) for _ in range(rng.randint(3, 6)))


def reply(rng, turn):
    parts = [f"## Step {turn}: {sentence(rng, 2, 4)[:-1]}", paragraph(rng)]
    for _ in range(rng.randint(3, 5)):
        kind = rng.random()
        if kind < 0.35:
            parts.append("\n".join(f"- **{rng.choice(WORDS)}**: {sentence(rng, 5, 12)}" for _ in range(rng.randint(3, 6))))
        elif kind < 0.55:
            parts.append("\n".join(f"{n}. {sentence(rng, 6, 14)}" for n in range(1, rng.randint(3, 6))))
        elif kind < 0.75:
            lang, body = rng.choice(CODE)
            parts.append(f"```{lang}\n{body}\n```")
        else:
            parts.append(f"> {sentence(rng)}")
        parts.append(paragraph(rng))
    return "\n\n".join(parts)


def atlas_rows():
    rng = random.Random(7)
    rows = []
    for turn in range(1, 81):
        rows.append({"role": "user", "text": f"{sentence(rng, 10, 30)} (request {turn})"})
        rows.append({"role": "assistant", "text": reply(rng, turn)})
    rows[-1]["text"] += f"\n\n{ATLAS_LAST}"
    return rows


def chat(id, title, last_active, said, answered):
    return {"id": id, "title": title, "last_active": last_active, "rows": [{"role": "user", "text": said}, {"role": "assistant", "text": answered}]}


def bot(name, title, color, canonical):
    return {
        **EMU, "name": name, "path": f"/tmp/hermes-proto-home/profiles/{name}", "is_default": False, "canonical_session": canonical,
        "ui_meta": {"hermes-bots": {"title": title, "color": color, "shape": "blobatar::round", "created": 1793000000000}},
    }


def bot_chat(id, rows):
    return {"id": id, "resolved_id": id, "root_title": "Bot Chat", "title": "Bot Chat", "preview": rows[-1]["text"][:27],
            "started_at": NOW - 86400, "last_active": NOW, "message_count": len(rows)}


atlas = atlas_rows()
birch = [{"role": "user", "text": "Water the ferns on Tuesday."}, {"role": "assistant", "text": "Birch noted: ferns on Tuesday."}]
roster = {
    "profiles": [EMU, bot("atlas", "Atlas", "#60a5fa", bot_chat("bench-atlas-bot", atlas)),
                 bot("birch", "Birch", "#34d399", bot_chat("bench-birch-bot", birch)), bot("cedar", "Cedar", "#f59e0b", None)],
    "bot_mode_protocol": True,
    "install_id": "fixture",
    "chats": {
        "atlas": [{"id": "bench-atlas-bot", "title": "Bot Chat", "hidden": True, "last_active": NOW, "rows": atlas}],
        "birch": [{"id": "bench-birch-bot", "title": "Bot Chat", "hidden": True, "last_active": NOW, "rows": birch}]
        + [chat(f"bench-birch-{n:02d}", f"Birch errand {n:02d}", NOW - n * 3600, f"Birch errand {n:02d}, please.", f"Birch did errand {n:02d}.") for n in range(1, 41)],
        "cedar": [chat(f"bench-cedar-{n}", f"Cedar task {n}", NOW - n * 3600, f"Cedar task {n}, please.", f"Cedar did task {n}.") for n in range(1, 4)],
    },
}
(HERE / "bench.json").write_text(json.dumps(roster, indent=1, ensure_ascii=False) + "\n")
size = len(json.dumps(atlas, ensure_ascii=False).encode())
print(f"wrote {HERE / 'bench.json'}: Atlas's Bot Chat has {len(atlas)} rows, {size // 1024} KB")
