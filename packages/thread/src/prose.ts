export type Inline =
  | { readonly t: 'text'; readonly v: string }
  | { readonly t: 'code'; readonly v: string }
  | { readonly t: 'strong' | 'em' | 'del'; readonly children: readonly Inline[] }
  | { readonly t: 'link'; readonly href: string; readonly children: readonly Inline[] }
  | { readonly t: 'break' }

export type Align = 'left' | 'center' | 'right' | null
export type Cell = readonly Inline[]

export type Block =
  | { readonly kind: 'paragraph'; readonly inline: readonly Inline[] }
  | { readonly kind: 'heading'; readonly level: 1 | 2 | 3 | 4 | 5 | 6; readonly inline: readonly Inline[] }
  | { readonly kind: 'list'; readonly ordered: boolean; readonly start: number; readonly items: readonly (readonly Block[])[] }
  | { readonly kind: 'quote'; readonly blocks: readonly Block[] }
  | { readonly kind: 'code'; readonly lang: string | null; readonly text: string; readonly open: boolean }
  | { readonly kind: 'table'; readonly align: readonly Align[]; readonly head: readonly Cell[]; readonly rows: readonly (readonly Cell[])[] }
  | { readonly kind: 'rule' }

interface Read { readonly block: Block; readonly next: number }

/** Tries to open a block at `lines[at]`. `interrupting` is true when the line would otherwise continue a paragraph. */
type Starter = (lines: readonly string[], at: number, interrupting: boolean) => Read | null

const blank = (line: string | undefined) => line === undefined || line.trim() === ''
const TAB = 4
const widthOf = (char: string, column: number) => (char === '\t' ? TAB - (column % TAB) : 1)

function indentOf(line: string): number {
  let column = 0
  for (const char of line) {
    if (char !== ' ' && char !== '\t') break
    column += widthOf(char, column)
  }
  return column
}

function dedent(line: string, columns: number): string {
  let [column, at] = [0, 0]
  while (at < line.length && column < columns && (line[at] === ' ' || line[at] === '\t')) column += widthOf(line[at++]!, column)
  return line.slice(at)
}

const FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/
const fence: Starter = (lines, at) => {
  const match = FENCE.exec(lines[at]!)
  if (match === null) return null
  const [, indent = '', marks = '', info = ''] = match
  if (marks[0] === '`' && info.includes('`')) return null
  const closing = new RegExp(`^ {0,3}${marks[0] === '`' ? '`' : '~'}{${marks.length},}\\s*$`)
  const body: string[] = []
  for (let next = at + 1; next < lines.length; next++) {
    if (closing.test(lines[next]!)) return { block: code(info, body, false), next: next + 1 }
    body.push(dedent(lines[next]!, indent.length))
  }
  return { block: code(info, body, true), next: lines.length }
}
const code = (info: string, body: readonly string[], open: boolean): Block =>
  ({ kind: 'code', lang: info.trim().split(/\s+/)[0] || null, text: body.join('\n'), open })

const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/
const heading: Starter = (lines, at) => {
  const match = HEADING.exec(lines[at]!)
  if (match === null) return null
  const level = match[1]!.length as 1 | 2 | 3 | 4 | 5 | 6
  return { block: { kind: 'heading', level, inline: parseInline(match[2] ?? '') }, next: at + 1 }
}

const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const rule: Starter = (lines, at) => (RULE.test(lines[at]!) ? { block: { kind: 'rule' }, next: at + 1 } : null)

const QUOTE = /^ {0,3}> ?/
const quote: Starter = (lines, at) => {
  if (!QUOTE.test(lines[at]!)) return null
  let next = at
  const body: string[] = []
  while (next < lines.length && QUOTE.test(lines[next]!)) body.push(lines[next++]!.replace(QUOTE, ''))
  return { block: { kind: 'quote', blocks: parseLines(body) }, next }
}

const ITEM = /^( {0,3})([-*+]|(\d{1,9})[.)])( {1,4}|[ \t]*$)/
interface Marker { readonly ordered: boolean; readonly start: number; readonly symbol: string; readonly width: number; readonly empty: boolean }

function markerOf(line: string): Marker | null {
  const match = ITEM.exec(line)
  if (match === null) return null
  const [whole, , marker = '', digits] = match
  const empty = line.length === whole.length
  return {
    ordered: digits !== undefined,
    start: digits === undefined ? 1 : Number(digits),
    symbol: marker.at(-1)!,
    width: empty ? whole.trimEnd().length + 1 : whole.length,
    empty
  }
}

/** An unindented line straight after item text, not after a closing fence, continues it, as a wrapped step does, unless it starts a block of its own. */
const wraps = (lines: readonly string[], at: number) =>
  !blank(lines[at - 1]) && !FENCE.test(lines[at - 1]!) && markerOf(lines[at]!) === null && startsBlock(lines, at, true) === null

const list: Starter = (lines, at, interrupting) => {
  const first = markerOf(lines[at]!)
  if (first === null || (interrupting && (first.empty || first.start !== 1))) return null
  const sameList = (marker: Marker | null): marker is Marker => marker !== null && marker.ordered === first.ordered && marker.symbol === first.symbol
  const items: Block[][] = []
  let next = at
  let marker: Marker | null = first
  while (sameList(marker)) {
    const body = [lines[next++]!.slice(marker.width)]
    while (next < lines.length && (blank(lines[next]) || indentOf(lines[next]!) >= marker.width || wraps(lines, next))) body.push(dedent(lines[next++]!, marker.width))
    items.push(parseLines(body))
    marker = next < lines.length ? markerOf(lines[next]!) : null
  }
  return { block: { kind: 'list', ordered: first.ordered, start: first.start, items }, next }
}

const DELIMITER_CELL = /^\s*(:?)-+(:?)\s*$/
const unescapedPipe = /(?<!\\)\|/

function cellsOf(row: string): string[] {
  const trimmed = row.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '')
  return trimmed.split(unescapedPipe).map(cell => cell.trim().replace(/\\\|/g, '|'))
}

const table: Starter = (lines, at) => {
  const [header, delimiter] = [lines[at]!, lines[at + 1]]
  if (delimiter === undefined || !unescapedPipe.test(header + delimiter)) return null
  const marks = cellsOf(delimiter).map(cell => DELIMITER_CELL.exec(cell))
  const names = cellsOf(header)
  if (marks.some(mark => mark === null) || marks.length !== names.length) return null
  const align = marks.map(mark => (mark![1] && mark![2] ? 'center' : mark![2] ? 'right' : mark![1] ? 'left' : null))
  const width = align.length
  const rows: Cell[][] = []
  let next = at + 2
  for (; next < lines.length && !blank(lines[next]) && !startsBlock(lines, next, true, table); next++) {
    const cells = cellsOf(lines[next]!)
    rows.push(Array.from({ length: width }, (_, column) => parseInline(cells[column] ?? '')))
  }
  return { block: { kind: 'table', align, head: names.map(name => parseInline(name)), rows }, next }
}

const STARTERS: readonly Starter[] = [fence, heading, rule, quote, list, table]

function startsBlock(lines: readonly string[], at: number, interrupting: boolean, except?: Starter): Read | null {
  for (const starter of STARTERS) {
    if (starter === except) continue
    const read = starter(lines, at, interrupting)
    if (read !== null) return read
  }
  return null
}

function paragraph(lines: readonly string[], at: number): Read {
  const text = [lines[at]!.trim()]
  let next = at + 1
  while (next < lines.length && !blank(lines[next]) && startsBlock(lines, next, true) === null) text.push(lines[next++]!.trim())
  return { block: { kind: 'paragraph', inline: parseInline(text.join('\n')) }, next }
}

function parseLines(lines: readonly string[]): Block[] {
  const blocks: Block[] = []
  for (let at = 0; at < lines.length;) {
    if (blank(lines[at])) {
      at++
      continue
    }
    const { block, next } = startsBlock(lines, at, false) ?? paragraph(lines, at)
    blocks.push(block)
    at = next
  }
  return blocks
}

export function parseMarkdown(source: string): readonly Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  if (lines.at(-1) === '') lines.pop()
  return parseLines(lines)
}

const PUNCTUATION = /[!-/:-@[-`{-~]/
const WORD = /[\p{L}\p{N}]/u
const SPACE = /\s/

function codeSpanEnd(source: string, at: number): { readonly end: number; readonly content: string } | null {
  const run = /^`+/.exec(source.slice(at))![0].length
  const closing = new RegExp(`(?<!\`)\`{${run}}(?!\`)`, 'g')
  closing.lastIndex = at + run
  const match = closing.exec(source)
  if (match === null) return null
  const raw = source.slice(at + run, match.index).replace(/\n/g, ' ')
  const content = raw.startsWith(' ') && raw.endsWith(' ') && raw.trim() !== '' ? raw.slice(1, -1) : raw
  return { end: match.index + run, content }
}

function runLength(source: string, at: number): number {
  let end = at
  while (source[end] === source[at]) end++
  return end - at
}

function emphasisEnd(source: string, at: number, mark: string, size: number): { readonly inner: string; readonly end: number } | null {
  const after = source[at + size]
  if (after === undefined || SPACE.test(after) || (mark === '_' && WORD.test(source[at - 1] ?? ''))) return null
  for (let scan = at + size; scan < source.length;) {
    const char = source[scan]!
    if (char === '\\') scan += 2
    else if (char === '`') scan = codeSpanEnd(source, scan)?.end ?? scan + runLength(source, scan)
    else if (char === mark) {
      const run = runLength(source, scan)
      const closes = (run === size || run >= 3) && scan > at + size && !SPACE.test(source[scan - 1]!) && !(mark === '_' && WORD.test(source[scan + run] ?? ''))
      if (closes) return { inner: source.slice(at + size, scan + run - size), end: scan + run }
      scan += run
    } else scan++
  }
  return null
}

function labelEnd(source: string, at: number): number {
  let depth = 0
  for (let scan = at; scan < source.length; scan++) {
    const char = source[scan]
    if (char === '\\') scan++
    else if (char === '`') scan = (codeSpanEnd(source, scan)?.end ?? scan + runLength(source, scan)) - 1
    else if (char === '[') depth++
    else if (char === ']' && --depth === 0) return scan
  }
  return -1
}

const DESTINATION = /^\(\s*(?:<([^<>\n]*)>|((?:[^\s()\\]|\\.|\((?:[^\s()\\]|\\.)*\))*))(?:\s+(?:"[^"]*"|'[^']*'|\([^()]*\)))?\s*\)/

function linkAt(source: string, at: number): { readonly label: string; readonly href: string; readonly end: number } | null {
  const close = labelEnd(source, at)
  if (close === -1) return null
  const target = DESTINATION.exec(source.slice(close + 1))
  if (target === null) return null
  const href = (target[1] ?? target[2] ?? '').replace(/\\(.)/g, '$1')
  return { label: source.slice(at + 1, close), href, end: close + 1 + target[0].length }
}

const AUTOLINK = /^<([a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s<>]*|[\w.!#$%&'*+/=?^`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)*)>/
const BARE_URL = /^https?:\/\/[^\s<]+/

function bareUrl(source: string, at: number): string | null {
  const before = source[at - 1]
  if (before !== undefined && !/[\s*_~(]/.test(before)) return null
  const match = BARE_URL.exec(source.slice(at))
  if (match === null) return null
  let url = match[0].replace(/[.,:;!?'"]+$/, '')
  while (url.endsWith(')') && url.split('(').length < url.split(')').length) url = url.slice(0, -1)
  return url
}

const unlinked = (nodes: readonly Inline[]): Inline[] => nodes.flatMap(node => (node.t === 'link' ? unlinked(node.children) : [node]))

function parseInline(source: string): Inline[] {
  const out: Inline[] = []
  let text = ''
  const flush = () => {
    if (text !== '') out.push({ t: 'text', v: text })
    text = ''
  }
  const push = (node: Inline) => {
    flush()
    out.push(node)
  }
  for (let at = 0; at < source.length;) {
    const char = source[at]!
    const next = source[at + 1]
    if (char === '\\' && next === '\n') {
      push({ t: 'break' })
      at += 2
    } else if (char === '\\' && next !== undefined && PUNCTUATION.test(next)) {
      text += next
      at += 2
    } else if (char === '\n') {
      push({ t: 'break' })
      at++
    } else if (char === '`') {
      const span = codeSpanEnd(source, at)
      if (span === null) {
        const run = runLength(source, at)
        text += source.slice(at, at + run)
        at += run
      } else {
        push({ t: 'code', v: span.content })
        at = span.end
      }
    } else if (char === '[' || (char === '!' && next === '[')) {
      const image = char === '!'
      const link = linkAt(source, image ? at + 1 : at)
      if (link === null) {
        text += char
        at++
      } else {
        push({ t: 'link', href: link.href, children: image ? [{ t: 'text', v: link.label }] : unlinked(parseInline(link.label)) })
        at = link.end
      }
    } else if (char === '<' && AUTOLINK.test(source.slice(at))) {
      const [whole, target = ''] = AUTOLINK.exec(source.slice(at))!
      push({ t: 'link', href: target.includes(':') ? target : `mailto:${target}`, children: [{ t: 'text', v: target }] })
      at += whole.length
    } else if (char === 'h' && bareUrl(source, at) !== null) {
      const url = bareUrl(source, at)!
      push({ t: 'link', href: url, children: [{ t: 'text', v: url }] })
      at += url.length
    } else if (char === '*' || char === '_' || (char === '~' && next === '~')) {
      const size = char === '~' ? 2 : Math.min(runLength(source, at), 2)
      const found = emphasisEnd(source, at, char, size)
      if (found === null) {
        const run = size === 2 ? runLength(source, at) : 1
        text += source.slice(at, at + run)
        at += run
      } else {
        push({ t: char === '~' ? 'del' : size === 2 ? 'strong' : 'em', children: parseInline(found.inner) })
        at = found.end
      }
    } else {
      text += char
      at++
    }
  }
  flush()
  return out
}

export type CodeBlock = Extract<Block, { readonly kind: 'code' }>

/** A run of text that find searches and the renderer marks: inline text, or a code block's text. */
export type ProseLeaf = readonly Inline[] | CodeBlock

/** The reply's leaves in reading order. Find and the renderer both number them from here, so a match lands on the element that shows it. */
export function proseLeaves(blocks: readonly Block[]): ProseLeaf[] {
  return blocks.flatMap((block): ProseLeaf[] => {
    switch (block.kind) {
      case 'paragraph':
      case 'heading': return [block.inline]
      case 'code': return [block]
      case 'list': return block.items.flatMap(proseLeaves)
      case 'quote': return proseLeaves(block.blocks)
      case 'table': return [...block.head, ...block.rows.flat()]
      case 'rule': return []
      default: return block satisfies never
    }
  })
}

const inlineText = (nodes: readonly Inline[]): string =>
  nodes.map(node => (node.t === 'text' || node.t === 'code' ? node.v : node.t === 'break' ? '\n' : inlineText(node.children))).join('')

/** A `<br>` counts as one character, `\n`, in this text and in the window's ranges. */
export const leafText = (leaf: ProseLeaf): string => ('kind' in leaf ? leaf.text : inlineText(leaf))
