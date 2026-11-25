"""Write fixtures/profiles/versions.json: the roster of fixtures/profiles/chats.json, with Research holding one chat
that was branched twice at its second message, and one chat that was never branched.

Run with any Python 3:  python3 fixtures/make_versions_fixture.py
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent / "profiles"
ROSTER = json.loads((HERE / "chats.json").read_text())
DOWNLOADS = next(chat for chat in ROSTER["chats"]["research"] if chat["title"] == "Clean up Downloads")

FIRST = ("Sort the invoices in the inbox folder by due date.", "Sorted fourteen invoices by due date; the oldest is due Friday.")
OWED = "\n".join(f"{n}. Invoice {1030 + n}, due in {n * 2} days" for n in range(1, 15))
SECONDS = [
    ("Now group them by customer.", "Grouped them under nine customers. Acme has the most, with four."),
    ("Now group them by month.", "Grouped them into three months. March holds eight of the fourteen."),
    ("Now group them by amount.", "Grouped them into three bands. Five invoices are over 1,000."),
]
THIRD = ("List what is still owed, oldest first.", f"Here is what is still owed:\n\n{OWED}")
CREATED = 1795249000


def rows_of(turns):
    return [row for ask, answer in turns for row in ({"role": "user", "text": ask}, {"role": "assistant", "text": answer})]


def chat(n, turns):
    title = "Sort the invoices" if n == 1 else f"Sort the invoices #{n}"
    seed = {"id": f"local-020{n}", "title": title, "last_active": CREATED + (n - 1) * 600, "rows": rows_of(turns)}
    return seed if n == 1 else {**seed, "branched_from": "local-0201"}


ROSTER["chats"] = {"research": [chat(1, [FIRST, SECONDS[0], THIRD]), chat(2, [FIRST, SECONDS[1]]), chat(3, [FIRST, SECONDS[2]]), DOWNLOADS]}
(HERE / "versions.json").write_text(json.dumps(ROSTER, indent=2, ensure_ascii=False) + "\n")
