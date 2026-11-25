import { loadFixture } from '@highwing/hermes/testing'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import { fieldId, leafText, parseMarkdown, proseLeaves, type Block } from '@highwing/thread'
import { grammarFor, loadGrammar } from '../src/renderer/chat/highlight'
import { Markdown } from '../src/renderer/chat/text'

function finalReply(path: string): string {
  const rows = loadFixture(path).steps.flatMap(step => ('stored' in step ? step.stored : []))
  const replies = rows.filter((row): row is { role: 'assistant'; text: string } =>
    typeof row === 'object' && row !== null && 'role' in row && row.role === 'assistant' && 'text' in row && typeof row.text === 'string')
  return replies.at(-1)!.text
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#x27': "'", '#39': "'" }
const textOf = (markup: string) => markup.replace(/<br\/>/g, '\n').replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|quot|#x27|#39);/g, (_, name: string) => ENTITIES[name]!)
const render = (source: string) => renderToStaticMarkup(<Markdown source={source} caret nodeKey="t1/0" />)

function findText(markup: string): string {
  let kept = ''
  let depth = 0
  for (const [piece, close, attrs] of markup.matchAll(/<(\/?)\w+([^>]*)>|[^<]+/g)) {
    const opens = close === '' && !attrs!.endsWith('/')
    const atom = / data-find-text="([^"]*)"/.exec(attrs ?? '')
    if (depth > 0) depth += attrs === undefined ? 0 : opens ? 1 : close === '/' ? -1 : 0
    else if (opens && atom !== null) [kept, depth] = [kept + atom[1], 1]
    else kept += piece
  }
  return textOf(kept)
}

const MARKED = /<(\w+)[^>]* data-find="([^"]*)"[^>]*>([\s\S]*?)<\/\1>/g
const markedText = (markup: string) => Array.from(markup.matchAll(MARKED), ([, , id, inner]) => [id, findText(inner!)])

const reply = finalReply('fixtures/markdown.jsonl')

const find = <K extends Block['kind']>(blocks: readonly Block[], kind: K) => blocks.filter((block): block is Extract<Block, { kind: K }> => block.kind === kind)

function rendersEveryPrefix() {
  for (let end = 0; end <= reply.length; end++) {
    const prefix = reply.slice(0, end)
    let markup = ''
    expect(() => { markup = render(prefix) }, `prefix of ${end} characters`).not.toThrow()
    expect(textOf(markup), `prefix of ${end} characters`).not.toContain('```')
  }
}

function marksEveryPrefix() {
  for (let end = 0; end <= reply.length; end++) {
    const prefix = reply.slice(0, end)
    const fields = proseLeaves(parseMarkdown(prefix)).map((leaf, index) => [fieldId('t1/0', `block ${index}`), leafText(leaf)])
    expect(markedText(render(prefix)), `prefix of ${end} characters`).toEqual(fields)
  }
}

const TS_BLOCK = `// Keep each backup for a week.
const days: number = 7
function backupName(file: string): string {
  return file + ".bak"
}`

describe('Markdown', () => {
  it('renders every prefix of the reply without throwing or showing a fence marker', rendersEveryPrefix)

  it('marks each shown text with the field find searches, at every prefix of the reply', marksEveryPrefix)

  it('reads the reply as a two-item list, a level-two heading, a link, a three-column table, an sh block and a ts block', () => {
    const blocks = parseMarkdown(reply)
    expect(find(blocks, 'list').map(list => list.items.length)).toEqual([2])
    expect(find(blocks, 'heading').map(heading => heading.level)).toEqual([2])
    expect(find(blocks, 'table').map(table => table.head.length)).toEqual([3])
    expect(find(blocks, 'code')).toEqual([
      { kind: 'code', lang: 'sh', text: 'cp notes.md notes.md.bak', open: false },
      { kind: 'code', lang: 'ts', text: TS_BLOCK, open: false }
    ])
    expect(render(reply)).toContain('<a href="https://example.com/style-guide" target="_blank" rel="noreferrer">style guide</a>')
  })

  it('shows an unclosed fence as code from its first line, with the caret inside it', () => {
    expect(render('Run this first:\n\n```sh\ncp n')).toContain('<code>cp n</code><span class="caret"></span></pre>')
    expect(render('Run this first:\n\n```')).toContain('<code></code><span class="caret"></span></pre>')
  })

  it('keeps a wrapped step inside its list item', () => {
    const [list] = parseMarkdown('1. Back up notes.md before renaming\nthe heading so you can revert\n2. Rename the heading\n3. Check the diff\n\nDone.')
    expect(list).toMatchObject({ kind: 'list', ordered: true, items: [[{ kind: 'paragraph' }], [{ kind: 'paragraph' }], [{ kind: 'paragraph' }]] })
    expect(textOf(render('1. Back up notes.md\nthe heading\n2. Rename'))).toBe('Back up notes.md\nthe headingRename')
  })

  it('ends a list at an unindented line after a closed fence', () => {
    expect(parseMarkdown('- run:\n  ```sh\n  ls\n  ```\nDone.').map(block => block.kind)).toEqual(['list', 'paragraph'])
  })

  it('keeps a tab inside a fence, so Copy gives back the text as written', () => {
    expect(parseMarkdown('```make\nbuild:\n\tcc -o app main.c\n```')).toEqual([{ kind: 'code', lang: 'make', text: 'build:\n\tcc -o app main.c', open: false }])
  })

  it('nests a list indented with a tab', () => {
    const [list] = parseMarkdown('- notes\n\t- notes.md\n- todo')
    expect(list).toMatchObject({ kind: 'list', items: [[{ kind: 'paragraph' }, { kind: 'list', items: [[{ kind: 'paragraph' }]] }], [{ kind: 'paragraph' }]] })
  })

  it('leaves a glob of stars as written', () => {
    expect(textOf(render('Edit src/**/*.ts files'))).toBe('Edit src/**/*.ts files')
  })

  it('draws a link only for a web address and leaves any other as plain text', () => {
    const markup = render('[run me](javascript:alert(1)) and [read me](file:///etc/passwd)')
    expect(markup).not.toContain('<a')
    expect(textOf(markup)).toBe('run me and read me')
  })

  it('typesets a formula, labelled with its source, and shows none of that source', () => {
    const markup = render('so $\\frac{a}{b}$ holds')
    expect(markup).toMatch(/<span class="math" role="math" aria-label="\\frac\{a\}\{b\}"[^>]*><span aria-hidden="true"><span class="katex">/)
    expect(textOf(markup)).not.toContain('\\frac')
  })

  it('shows a formula KaTeX cannot read as its source', () => {
    let markup = ''
    expect(() => { markup = render('so $\\frac{a$ holds') }).not.toThrow()
    expect(markup).toContain('<code class="math" role="math" aria-label="\\frac{a" data-find-text="\\frac{a">\\frac{a</code>')
  })

  it('typesets a display formula whose TeX an earlier inline formula repeats with a leading $', () => {
    expect(render('so \\($x\\) fails\n\n$$x$$')).toContain('class="katex-display"')
  })

  it('gives find the same text around a formula as the field it searches', () => {
    const source = 'so $\\frac{a}{b}$ holds, $\\frac{a$ fails and\n\n$$\n\\sqrt{x}\n$$'
    const fields = proseLeaves(parseMarkdown(source)).map((leaf, index) => [fieldId('t1/0', `block ${index}`), leafText(leaf)])
    expect(markedText(render(source))).toEqual(fields)
    expect(fields.map(([, text]) => text)).toEqual(['so \\frac{a}{b} holds, \\frac{a fails and', '\\sqrt{x}'])
  })

  it('keeps unclosed inline markers and raw HTML as written', () => {
    expect(textOf(render('a **bold start and <b>tag</b>'))).toBe('a **bold start and <b>tag</b>')
  })
})

const COLORED = /<span class="hljs-[^"]+">/
const codeBlocks = (markup: string) => Array.from(markup.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/g), ([, inner]) => inner!)

describe('Markdown with the grammars loaded', () => {
  beforeAll(() => Promise.all(['sh', 'ts'].map(lang => loadGrammar(grammarFor(lang)!))))

  it('colors both code blocks of the reply', () => {
    const blocks = codeBlocks(render(reply))
    expect(blocks).toHaveLength(2)
    for (const block of blocks) expect(block).toMatch(COLORED)
  })

  it('renders every prefix of the reply without throwing or showing a fence marker', rendersEveryPrefix)

  it('marks each shown text with the field find searches, at every prefix of the reply', marksEveryPrefix)

  it('shows a colored ts block with exactly the text it was given', () => {
    const source = 'const tag = `<${name} a="1">` && b > c\n// it\'s \'quoted\' & <done>\nlet n: number = 0x1F'
    const markup = render(`\`\`\`ts\n${source}\n\`\`\``)
    expect(markup).toMatch(COLORED)
    expect(codeBlocks(markup).map(textOf)).toEqual([source])
  })

  it('reads the fence name in any case', () => {
    expect(render('```TS\nconst days = 7\n```')).toMatch(COLORED)
  })

  it('keeps a fence that is still streaming plain', () => {
    const markup = render('```ts\nconst days = 7')
    expect(markup).toContain('<code>const days = 7</code><span class="caret"></span></pre>')
    expect(markup).not.toMatch(COLORED)
  })

  it('leaves a block plain when its language is unknown or missing, and never guesses one', () => {
    for (const fence of ['```', '```elixir', '```text']) expect(render(`${fence}\nconst days = 7\n\`\`\``)).not.toMatch(COLORED)
  })

  it('knows no grammar for a fence named after a built-in object property', () => {
    for (const lang of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) expect(grammarFor(lang), lang).toBeNull()
  })

  it('leaves a block over 100,000 characters plain', () => {
    const long = 'const days = 7\n'.repeat(7_000).trimEnd()
    expect(long.length).toBeGreaterThan(100_000)
    const markup = render(`\`\`\`ts\n${long}\n\`\`\``)
    expect(markup).not.toMatch(COLORED)
    expect(codeBlocks(markup).map(textOf)).toEqual([long])
  })
})
