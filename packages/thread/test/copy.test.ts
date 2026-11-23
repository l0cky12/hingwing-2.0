import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { activityOf, sessionOf, type Tracked } from '../../hermes/src/domain/reduce'
import type { Link } from '../../hermes/src/domain/session'
import { errand, fold, type Moment } from '../../hermes/test/support/story'
import { threadView, type RecordSection, type ThreadNode } from '../src/thread-view'

type Changes = Extract<RecordSection, { kind: 'changes' }>

const ONLINE: Link = { state: 'online' }
const CLOCK = { now: 0, timeZone: 'UTC' }
const story = errand()
const view = (state: Tracked) => threadView(sessionOf(state, ONLINE, null), CLOCK)

const moments: Moment[] = []
const settled = view(fold(story, moment => moments.push(moment)))
const nodes = settled.turns.flatMap(turn => turn.nodes)
const steps = nodes.flatMap(node => (node.kind === 'step' ? [node.step] : node.kind === 'group' ? node.steps : []))
const sections = steps.flatMap(step => step.record?.sections ?? [])
const changes = sections.filter((section): section is Changes => section.kind === 'changes')

const CLOSING_REPLY = [
  'Done. I created `notes.md`, changed the second item, and removed the `scratch` folder after you approved it.',
  '',
  '```markdown',
  '# Todo',
  '',
  '- [ ] sketch the chat view',
  '- [ ] ship the prototype',
  '- [ ] review screenshots',
  '```'
].join('\n')

function applyToPreimage(copy: string, lines: Changes['lines']) {
  const side = (kinds: readonly string[]) => lines.filter(line => kinds.includes(line.t)).map(line => `${line.text}\n`).join('')
  const creates = copy.startsWith('--- /dev/null')
  const dir = mkdtempSync(join(tmpdir(), 'highwing-copy-'))
  try {
    if (!creates) writeFileSync(join(dir, 'file'), side(['ctx', 'del']))
    const [, , ...body] = copy.split('\n')
    writeFileSync(join(dir, 'change.diff'), [creates ? '--- /dev/null' : '--- a/file', '+++ b/file', ...body].join('\n'))
    execFileSync('git', ['apply', 'change.diff'], { cwd: dir })
    return { expected: side(['ctx', 'add']), actual: readFileSync(join(dir, 'file'), 'utf8') }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('what a Copy control puts on the clipboard', () => {
  it('copies the closing reply as the Markdown Hermes wrote, code fence included', () => {
    const prose = nodes.filter((node): node is Extract<ThreadNode, { kind: 'prose' }> => node.kind === 'prose')
    expect(prose.at(-1)?.markdown).toBe(CLOSING_REPLY)
  })

  it('copies an approval command exactly, with no prompt sign', () => {
    const asking = moments.find(({ state }) => activityOf(state.content).kind === 'asking')!
    const card = view(asking.state).turns.flatMap(turn => turn.nodes).flatMap(node => (node.kind === 'prompt' ? [node.card] : []))[0]
    expect(card?.command).toBe('rm -rf /tmp/hermes-proto-work/scratch')
  })

  it('copies each change as a unified diff that applies cleanly, with no mark doubled', () => {
    expect(changes.length).toBeGreaterThanOrEqual(2)
    for (const { copy, lines } of changes) {
      if (copy === null) throw new Error('a whole diff from the errand copies nothing')
      expect(copy).toMatch(/^--- (\/dev\/null|a\/.+)\n\+\+\+ b\/.+\n@@ /)
      expect(copy.endsWith('\n')).toBe(true)
      expect(copy).not.toContain('−')
      const { expected, actual } = applyToPreimage(copy, lines)
      expect(actual).toBe(expected)
    }
    expect(changes.some(section => section.copy?.startsWith('--- /dev/null'))).toBe(true)
  })

  it('copies output as its body text and offers nothing for "No output"', () => {
    const outputs = sections.flatMap(section => (section.kind === 'output' ? [section] : []))
    const listing = outputs.find(section => 'text' in section.body)
    expect(listing?.copy).toBe(listing && 'text' in listing.body ? listing.body.text : undefined)
    expect(listing?.copy).toContain('old.txt')
    expect(outputs.find(section => 'empty' in section.body)?.copy).toBeNull()
  })
})
