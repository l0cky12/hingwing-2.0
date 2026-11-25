"""Write the files the attachments recipes stage, under fixtures/attach/.

Run:  python3 -I fixtures/make_attach_files.py

- error.png: a 48x32 PNG, small enough for any limit a recipe sets.
- error-big.png: a 96x96 PNG of noise, about 27 KB, so `--attach-limit 20000` refuses it.
- contract.pdf: a one-line PDF, staged as a file because its bytes are no image.
"""
import random
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent / "attach"


def png(width, height, pixel):
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    rows = b"".join(b"\x00" + b"".join(pixel(x, y) for x in range(width)) for y in range(height))
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b"")


def stripes(x, y):
    return bytes((163, 64, 43)) if (x // 8 + y // 8) % 2 == 0 else bytes((246, 247, 243))


noise = random.Random(70)

OUT.mkdir(exist_ok=True)
(OUT / "error.png").write_bytes(png(48, 32, stripes))
(OUT / "error-big.png").write_bytes(png(96, 96, lambda x, y: bytes(noise.randrange(256) for _ in range(3))))
(OUT / "contract.pdf").write_bytes(b"%PDF-1.7\n% The parties agree to keep this contract short.\n%%EOF\n")
