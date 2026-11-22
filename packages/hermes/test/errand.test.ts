import { describe, expect, it } from 'vitest'
import { activityOf } from '../src/domain/reduce'
import type { Item, SettledTurn, TextItem, ToolItem } from '../src/domain/session'
import { errand, fold, foldWithDrop, type Beat, type Moment } from './support/story'

const story = errand()
const REQUEST = "In /tmp/hermes-proto-work: make notes.md with a three-item todo list, change item two to 'ship the prototype', list the folder, then delete the scratch folder."

const text = (item: Item | undefined) => (item as TextItem).markdown.trim()
const tool = (item: Item | undefined) => item as ToolItem<'settled'>
const done = (item: Item | undefined) => {
  const status = tool(item).status
  if (status.s !== 'done') throw new Error(`tool ${tool(item).name} is ${status.s}, expected done`)
  return status
}

describe('the errand, folded through parse and reduce', () => {
  const end = fold(story)
  const turn = end.content.history[0] as SettledTurn

  it('settles one complete turn and leaves nothing running or unsent', () => {
    expect(end.content.run).toEqual({ state: 'idle' })
    expect(end.content.outbox).toEqual([])
    expect(end.content.history).toHaveLength(1)
    expect(turn.outcome).toEqual({ kind: 'complete' })
    expect(turn.rows).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(turn.request).toEqual({ text: REQUEST, inputId: 'input_990d3cd8381d422f' })
  })

  // docs/design/reference/settled-C.png, top to bottom. The approval line sits above "Ran rm -rf" in
  // the screenshot and after the rm tool here, because the gateway starts the tool before it asks.
  // Placing it is a view rule for unit 3 (rationale.md, open question 10).
  it('holds what the settled-C screenshot shows', () => {
    expect(turn.items.map(item => (item.kind === 'tool' ? `tool:${item.name}` : item.kind))).toEqual([
      'text', 'tool:write_file', 'tool:patch', 'text', 'tool:terminal', 'tool:terminal', 'prompt', 'text'
    ])
    const [intro, write, patch, checking, ls, rm, approval, outro] = turn.items

    expect(text(intro)).toBe("I'll create the notes file first, then make the edit.")

    expect(done(write).diffs).toMatchObject([{ path: expect.stringMatching(/notes\.md$/), createsFile: true, added: 5, removed: 0 }])
    expect(done(patch).diffs).toMatchObject([{ path: expect.stringMatching(/notes\.md$/), createsFile: false, added: 1, removed: 1 }])

    expect(text(checking)).toBe('Edited. Checking the folder before I delete anything.')

    expect(tool(ls).args.command).toBe('cd /tmp/hermes-proto-work && ls -la && ls scratch')
    expect(done(ls).result).toMatchObject({ kind: 'command', exitCode: 0 })
    expect(done(ls).result).toHaveProperty('output', expect.stringContaining('old.txt'))

    expect(tool(rm).args.command).toBe('rm -rf /tmp/hermes-proto-work/scratch')
    expect(done(rm).result.kind).toBe('command')

    expect(approval).toMatchObject({
      kind: 'prompt',
      ask: { kind: 'approval', command: 'rm -rf /tmp/hermes-proto-work/scratch' },
      state: { s: 'answered', reply: { kind: 'choice', value: 'once' } }
    })

    expect(text(outro)).toBe(
      'Done. I created `notes.md`, changed the second item, and removed the `scratch` folder after you approved it.\n\n' +
        '```markdown\n# Todo\n\n- [ ] sketch the chat view\n- [ ] ship the prototype\n- [ ] review screenshots\n```'
    )
  })

  it('is working on the folder listing, then asking before the delete, as the tool-running and approval shots show', () => {
    const moments: Moment[] = []
    fold(story, moment => moments.push(moment))
    const activities = moments.map(({ state }) => {
      const activity = activityOf(state.content)
      if (state.content.run.state !== 'running' || !('item' in activity)) return activity.kind
      const item = state.content.run.turn.items[activity.item]
      return item?.kind === 'tool' ? `${activity.kind}:${String(item.args.command ?? item.name)}` : activity.kind
    })
    expect(activities).toContain('working:cd /tmp/hermes-proto-work && ls -la && ls scratch')
    expect(activities).toContain('asking')
    expect(activities.indexOf('asking')).toBeGreaterThan(activities.indexOf('working:cd /tmp/hermes-proto-work && ls -la && ls scratch'))
    expect(activities.at(-1)).toBe('idle')
  })

  it('ignores every frame delivered a second time', () => {
    const doubled = { ...story, beats: story.beats.flatMap((beat): Beat[] => (beat.kind === 'frame' ? [beat, beat] : [beat])) }
    expect(fold(doubled).content).toEqual(end.content)
  })
})

describe('a socket drop after every frame of the errand', () => {
  const want = fold(story).content
  const frames = story.frames.length

  it.each(Array.from({ length: frames }, (_, i) => i + 1))('drop after frame %i, 3 missed, ends in the undisturbed session', afterFrame => {
    const got = foldWithDrop(story, afterFrame, 3)
    expect(got.gate.at).toBe('live')
    expect(got.content).toEqual(want)
  })

  it('covers every frame of the story', () => {
    expect(frames).toBe(story.fixture.steps.filter(step => 'push' in step).length)
  })
})
