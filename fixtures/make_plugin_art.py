import base64
import json
import struct
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent

GLYPHS = {
    "a": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    "b": ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
    "c": ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
    "e": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    "f": ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
    "i": ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
    "l": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    "m": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
    "n": ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    "o": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    "p": ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    "r": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    "s": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    "t": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    "w": ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
    "y": ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
    "0": ["01110", "10011", "10101", "10101", "10101", "11001", "01110"],
    "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
}
WIDTH, HEIGHT = 208, 104

BANNERS = {
    "spotify": ("#1DB954", "#0B3D20"),
    "browser-tools": ("#3B6FD8", "#F2F5FB"),
    "linear-sync": ("#5E6AD2", "#FFFFFF"),
    "mem0": ("#F4B23E", "#2A1B05"),
}
REFUSED_SVG = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="18" r="12" fill="#E0442F"/></svg>\n'


def png(width, height, pixel):
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    rows = b"".join(b"\x00" + b"".join(pixel(x, y) for x in range(width)) for y in range(height))
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b"")


def hex_rgb(color):
    return bytes(int(color[i:i + 2], 16) for i in (1, 3, 5))


def banner(name, paper, ink):
    paper, ink = hex_rgb(paper), hex_rgb(ink)
    scale = min(4, (WIDTH - 24) // (len(name) * 6))
    left = (WIDTH - (len(name) * 6 - 1) * scale) // 2
    top = (HEIGHT - 7 * scale) // 2

    def pixel(x, y):
        column, row = (x - left) // scale, (y - top) // scale
        if x < left or y < top or row >= 7 or column >= len(name) * 6 or column % 6 == 5:
            return paper
        return ink if GLYPHS[name[column // 6]][row][column % 6] == "1" else paper
    return png(WIDTH, HEIGHT, pixel)


image = {row["name"]: row["image"] for row in json.loads((HERE / "plugins" / "catalog.json").read_text())}
art = {image[name]: base64.b64encode(banner(name, paper, ink)).decode("ascii") for name, (paper, ink) in BANNERS.items()}
art[image["pomodoro"]] = base64.b64encode(REFUSED_SVG).decode("ascii")
(HERE / "plugins" / "art.json").write_text(json.dumps(art, indent=2) + "\n")
