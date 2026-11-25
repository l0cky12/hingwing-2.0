"""Write what the scripted gateway answers for image.generate (fixtures/images/) and the pet calls (fixtures/pets/).

Run:  python3 -I fixtures/make_picture_fixtures.py

- images/drawn.json: a Hermes with an image model whose generation takes 1.2 s and answers a 256x256 PNG of a robot.
- images/none.json: a Hermes with no image model.
- images/failing.json: a Hermes whose image model fails every generation.
- pets/gallery.json: 30 pets, as pet.gallery lists them, curated ones last so a client has to sort them. Mochi is
  installed, and Basil is installed with no sheet to fetch, as a pet petdex no longer lists. Each answers
  pet.thumb with a 96x104 PNG idle frame, the size Hermes crops (agent/pet/store.py:29-31), except Dune and Velvet,
  which have none.
- pets/none.json: a Hermes that lists no pets.
- pets/refused.json: the gallery of gallery.json, whose first pet.thumb for Tabby fails, as a call lost to a timeout would.

Each sheet the gallery names is on a petdex host, the only hosts Hermes fetches a sheet from (agent/pet/store.py:215-221).
"""
import base64
import json
import struct
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent


def png(width, height, pixel, alpha=False):
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    rows = b"".join(b"\x00" + b"".join(pixel(x, y) for x in range(width)) for y in range(height))
    header = struct.pack(">IIBBBBB", width, height, 8, 6 if alpha else 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b"")


def data_url(blob):
    return "data:image/png;base64," + base64.b64encode(blob).decode("ascii")


def hex_rgb(color):
    return tuple(int(color[i:i + 2], 16) for i in (1, 3, 5))


def mix(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def in_round_rect(x, y, left, top, right, bottom, radius):
    if not (left <= x < right and top <= y < bottom):
        return False
    dx = max(left + radius - x, 0, x - (right - 1 - radius))
    dy = max(top + radius - y, 0, y - (bottom - 1 - radius))
    return dx * dx + dy * dy <= radius * radius


def robot(x, y):
    sand, coral, ink, mint, amber = hex_rgb("#F3E3C0"), hex_rgb("#D96A4E"), hex_rgb("#1F2A26"), hex_rgb("#9FE3D1"), hex_rgb("#D49A2A")
    color = mix(sand, coral, (x + y) / 510)
    if 122 <= x < 134 and 52 <= y < 90:
        color = ink
    if (x - 128) ** 2 + (y - 46) ** 2 <= 12 ** 2:
        color = amber
    if in_round_rect(x, y, 66, 88, 190, 192, 26):
        color = ink
        if (x - 102) ** 2 + (y - 132) ** 2 <= 14 ** 2 or (x - 154) ** 2 + (y - 132) ** 2 <= 14 ** 2 or (102 <= x < 154 and 162 <= y < 170):
            color = mint
    return bytes(color)


SPRITES = {
    "cat": [
        "f..........f",
        "ff........ff",
        "fff......fff",
        "ffffffffffff",
        "ffffffffffff",
        "ffeffffffeff",
        "ffeffffffeff",
        "fffffnnfffff",
        "ffffbbbbffff",
        ".ffbbbbbbff.",
        ".ffbbbbbbff.",
        "..ffffffff..",
        "..ff....ff..",
    ],
    "bunny": [
        "..ff....ff..",
        "..fb....bf..",
        "..fb....bf..",
        "..fb....bf..",
        ".ffffffffff.",
        "ffffffffffff",
        "ffeffffffeff",
        "fffffnnfffff",
        "ffffbbbbffff",
        ".ffbbbbbbff.",
        ".ffbbbbbbff.",
        "..ffffffff..",
        "..ff....ff..",
    ],
    "bear": [
        "ff........ff",
        "ffffffffffff",
        "ffffffffffff",
        "ffeffffffeff",
        "ffeffffffeff",
        "ffffbbbbffff",
        "fffbbeebbfff",
        "ffffbbbbffff",
        ".ffffffffff.",
        "ffbbbbbbbbff",
        "ffbbbbbbbbff",
        ".ffffffffff.",
        ".fff....fff.",
    ],
    "frog": [
        ".fff....fff.",
        "fefff..fffef",
        "fefff..fffef",
        "ffffffffffff",
        "ffffffffffff",
        "fffeeeeeefff",
        "ffffffffffff",
        ".ffbbbbbbff.",
        "ffbbbbbbbbff",
        "ffbbbbbbbbff",
        ".ffffffffff.",
        "ff.ff..ff.ff",
        "............",
    ],
    "owl": [
        "f..........f",
        "ff........ff",
        "ffffffffffff",
        "fbbbffffbbbf",
        "fbebffffbebf",
        "fbbbfnnfbbbf",
        "fffffnnfffff",
        "ffbbbbbbbbff",
        "ffbfbfbfbfff",
        "ffbbbbbbbbff",
        ".ffffffffff.",
        "..nn....nn..",
        "............",
    ],
    "fox": [
        "f..........f",
        "ff........ff",
        "fff......fff",
        "ffffffffffff",
        "fffffffffff.",
        "bfeffffffefb",
        "bbffffffffbb",
        ".bbbbeebbbb.",
        "..bbbbbbbb..",
        "..ffffffff..",
        ".ffffffffff.",
        ".fff....fff.",
        "............",
    ],
}

PETS = [
    ("biscuit", "Biscuit", "bear", "#C08A52", "#F1DDBF"),
    ("juniper", "Juniper", "owl", "#5F7A8C", "#DDE6EA"),
    ("pip", "Pip", "frog", "#7BA35B", "#DCEBC4"),
    ("sable", "Sable", "cat", "#3B3B3B", "#E8E3DA"),
    ("maple", "Maple", "fox", "#C6643A", "#F6EBDD"),
    ("nimbus", "Nimbus", "bunny", "#DADDE2", "#F4C9D2"),
    ("olive", "Olive", "frog", "#8A9440", "#E3E6C2"),
    ("pistachio", "Pistachio", "bear", "#9DB77D", "#E6EFD9"),
    ("quill", "Quill", "owl", "#8C6A4C", "#EADBC8"),
    ("rusty", "Rusty", "fox", "#B04A34", "#F3E3D8"),
    ("saffron", "Saffron", "cat", "#D49A2A", "#F6E8C6"),
    ("thistle", "Thistle", "bunny", "#B6A2CC", "#F2E9F7"),
    ("umber", "Umber", "bear", "#6E5640", "#D9C7B2"),
    ("velvet", "Velvet", "cat", "#7A4A5A", "#EBD8DE"),
    ("willow", "Willow", "frog", "#5B8A4E", "#D2E4C6"),
    ("yuzu", "Yuzu", "owl", "#D8B43A", "#FBF1CF"),
    ("ziggy", "Ziggy", "fox", "#E08A3C", "#FFF1E0"),
    ("acorn", "Acorn", "bear", "#8C6A4C", "#E2D0BA"),
    ("basil", "Basil", "frog", "#4E7D45", "#CFE3C6"),
    ("cinder", "Cinder", "cat", "#4A4A4A", "#D9D9D9"),
    ("dune", "Dune", "bunny", "#D9C49A", "#F6EEDB"),
    ("fennel", "Fennel", "owl", "#7C8783", "#E3E8E5"),
    ("tabby", "Tabby", "cat", "#D49A2A", "#F3E3C0"),
    ("clover", "Clover", "bunny", "#EDEAE3", "#F4C9D2"),
    ("bruno", "Bruno", "bear", "#8C6A4C", "#D9C2A3"),
    ("ribbit", "Ribbit", "frog", "#5B8A4E", "#C9DFAE"),
    ("hoot", "Hoot", "owl", "#7A68A8", "#E3DDF0"),
    ("ember", "Ember", "fox", "#D96A4E", "#F6F7F3"),
    ("mochi", "Mochi", "cat", "#4A4A4A", "#F6F7F3"),
    ("pebble", "Pebble", "bear", "#9AA7A2", "#E3E8E5"),
]
CURATED = {"tabby", "clover", "bruno", "ribbit", "hoot", "ember", "mochi", "pebble"}
INSTALLED = {"mochi", "basil"}
# Hermes holds Basil and petdex no longer lists it, so its entry has no sheet to fetch (tui_gateway/methods_session.py:1490-1493).
LOCAL_ONLY = {"basil"}
WITHOUT_THUMB = {"dune", "velvet"}
SCALE = 8


def idle_frame(kind, fur, belly):
    palette = {"f": hex_rgb(fur) + (255,), "b": hex_rgb(belly) + (255,), "e": (31, 42, 38, 255), "n": (194, 106, 134, 255), ".": (0, 0, 0, 0)}
    grid = SPRITES[kind]
    return png(12 * SCALE, 13 * SCALE, lambda x, y: bytes(palette[grid[y // SCALE][x // SCALE]]), alpha=True)


def gallery_entry(slug, name):
    if slug in LOCAL_ONLY:
        return {"slug": slug, "displayName": name, "installed": True, "spritesheetUrl": "", "generated": False}
    shelf = "curated" if slug in CURATED else "pets"
    return {"slug": slug, "displayName": name, "installed": slug in INSTALLED, "spritesheetUrl": f"https://cdn.petdex.dev/{shelf}/{slug}/spritesheet.webp",
            "curated": slug in CURATED, "generated": False}


def write(path, value):
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n")


write(HERE / "images" / "drawn.json", {"available": True, "picture": data_url(png(256, 256, robot)), "delay_ms": 1200})
write(HERE / "images" / "none.json", {"available": False})
write(HERE / "images" / "failing.json", {"available": True, "error": "The image provider is out of credit.", "delay_ms": 300})
GALLERY = {
    "pets": [gallery_entry(slug, name) for slug, name, *_ in PETS],
    "thumbs": {slug: data_url(idle_frame(kind, fur, belly)) for slug, _, kind, fur, belly in PETS if slug not in WITHOUT_THUMB},
    "delay_ms": 200,
}
write(HERE / "pets" / "gallery.json", GALLERY)
write(HERE / "pets" / "refused.json", {**GALLERY, "refused_once": ["tabby"]})
write(HERE / "pets" / "none.json", {"pets": [], "thumbs": {}})
