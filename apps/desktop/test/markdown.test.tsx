import { loadFixture } from '@highwing/hermes/testing'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { fieldId, leafText, parseMarkdown, proseLeaves, type Block } from '@highwing/thread'
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

const MARKED = /<(\w+)[^>]* data-find="([^"]*)"[^>]*>([\s\S]*?)<\/\1>/g
const markedText = (markup: string) => Array.from(markup.matchAll(MARKED), ([, , id, inner]) => [id, textOf(inner!)])

const reply = finalReply('fixtures/markdown.jsonl')

const find = <K extends Block['kind']>(blocks: readonly Block[], kind: K) => blocks.filter((block): block is Extract<Block, { kind: K }> => block.kind === kind)

const TS_BLOCK = `// Keep each backup for a week.
const days: number = 7
function backupName(file: string): string {
  return file + ".bak"
}`

describe('Markdown', () => {
  it('renders every prefix of the reply without throwing or showing a fence marker', () => {
    for (let end = 0; end <= reply.length; end++) {
      const prefix = reply.slice(0, end)
      let markup = ''
      expect(() => { markup = render(prefix) }, `prefix of ${end} characters`).not.toThrow()
      expect(textOf(markup), `prefix of ${end} characters`).not.toContain('```')
    }
  })

  it('marks each shown text with the field find searches, at every prefix of the reply', () => {
    for (let end = 0; end <= reply.length; end++) {
      const prefix = reply.slice(0, end)
      const fields = proseLeaves(parseMarkdown(prefix)).map((leaf, index) => [fieldId('t1/0', `block ${index}`), leafText(leaf)])
      expect(markedText(render(prefix)), `prefix of ${end} characters`).toEqual(fields)
    }
  })

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

  it('keeps unclosed inline markers and raw HTML as written', () => {
    expect(textOf(render('a **bold start and <b>tag</b>'))).toBe('a **bold start and <b>tag</b>')
  })
})
