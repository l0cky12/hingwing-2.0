# Math in replies

A formula in a reply shows as typeset math, not as TeX source. `$...$` and `\(...\)` sit in the line. `$$...$$`, and `\[...\]` on lines of their own, get a centered line of their own that scrolls sideways when it is wider than the reply. KaTeX draws each formula with fonts that ship in the app bundle, so no network is needed. Each formula is a `math` element whose accessible name is its TeX source, and Find searches that source. A formula that KaTeX cannot parse shows its source as code, with the same role and name. A dollar sign next to a digit, as in "costs $5 and $10", stays text, and so does a formula still streaming, until its closing delimiter arrives.

## Sub-features

- `math-typeset` draws three inline and two display formulas from one reply, each named with its source, with no `\frac` in the visible text.
- `math-malformed` shows `\sqrt{x` as code, named with its source like a typeset formula, with no error and no console error.
- `math-dollars` leaves "costs $5 and the answer key costs $10" and the code span `$x$` as written.
- `math-find` finds and marks the words right after a formula, and a match inside a formula marks the whole formula.
- `math-offline` loads the KaTeX fonts with only the loopback link up.
- `math-parse` holds the parser's rules in `packages/thread/test/math.test.ts`, not a run.

## How to get to it (user POV)

- Run `HIGHWING_FIXTURE=$PWD/fixtures/math.jsonl pnpm --filter @highwing/desktop start` from the repo root, type in the "Message Hermes" box and press Send.

## Driving it with highwing-verify

Preconditions:

- `$H doctor` prints only `ok` lines and the build is current.
- `fixtures/math.jsonl` comes from `python3 -I fixtures/make_math_fixture.py`. `--check` proves the script rebuilds `fixtures/markdown.jsonl` from itself byte for byte.

The reply's formulas are `ax^2 + bx + c = 0`, `a \neq 0`, `x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}`, `b^2 - 4ac` and `x_v = -\frac{b}{2a}`. Its malformed one is `\sqrt{x`.

- **Typeset.** Run `$H run --fixture fixtures/math.jsonl --run math wait live type "Message Hermes" @request click button Send wait settled tally math 6 count math "\sqrt{x" 1 count math "x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}" 1 count math "b^2 - 4ac" 1 absent "\frac" see "\sqrt{x" see "costs \$5 and the answer key costs \$10" shot math quiet`. In `math.png` the two display formulas are centered on lines of their own and the inline ones sit in their sentences. `math.aria.txt` holds six `math` nodes named with their source, the malformed `\sqrt{x` among them, and `code: $x$`.
- **Find around a formula.** Run `$H run --fixture fixtures/math.jsonl --run math-find wait live type "Message Hermes" @request click button Send wait settled press Control+f type "Find in chat" "has two roots" press Enter see "1 of 1" marks 1 marked "has two roots" type "Find in chat" "is the discriminant" press Enter see "1 of 1" marked "is the discriminant" shot math-find-around type "Find in chat" 4ac press Enter see "1 of 2" marks 2 shot math-find-inside quiet`. "has two roots" follows `a \neq 0` and "is the discriminant" follows `b^2 - 4ac`, so `marked` proves the offsets past a formula hold. `math-find-inside.png` marks the whole display formula, and the inline `b^2 - 4ac`.
- **Offline.** Run `unshare -rn sh -c "ip link set lo up && $H run --fixture fixtures/math.jsonl --run math-offline wait live type 'Message Hermes' @request click button Send wait settled fonts KaTeX_Main fonts KaTeX_Math shot math-offline quiet"`. The namespace has only the loopback link. `steps.log` lists the loaded KaTeX faces, and `math-offline.png` matches `math.png`.

## Gotchas

- The shell eats `$5` in double quotes. Write `\$5` inside `"..."`, or use single quotes.
- `fonts` passes only for a family some text on the page uses, because the browser loads a face on first use. `KaTeX_Main` and `KaTeX_Math` are drawn by every formula in this reply.
- A match inside a formula marks the whole formula, because its TeX is one unit of Find's text. `marked` reads the range's text, which for a formula is KaTeX's glyphs, not the TeX, so use it only on plain words.
- `\[x\]` in the middle of a sentence is an escaped bracket pair, not math. Only `\[` at the start of a line opens display math.
