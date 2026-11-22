import { describe, expect, it } from 'vitest'
import { activityOf, reduce, sessionOf, type Tracked } from '../../hermes/src/domain/reduce'
import type { Link } from '../../hermes/src/domain/session'
import { errand, fold, foldWithDrop, type Moment } from '../../hermes/test/support/story'
import { checkThread, outline, threadView } from '../src/thread-view'

const ONLINE: Link = { state: 'online' }
const story = errand()
const view = (state: Tracked) => threadView(sessionOf(state, ONLINE, null))

const moments: Moment[] = []
fold(story, moment => moments.push(moment))

function momentWhere(test: (state: Tracked) => boolean): Tracked {
  const found = moments.find(({ state }) => test(state))
  if (!found) throw new Error('no moment of the errand matches')
  return found.state
}

const HEAD = [
  "> In /tmp/hermes-proto-work: make notes.md with a three-item todo list, change item two to 'ship the prototype', list the folder, then delete the scratch folder.",
  "| I'll create the notes file first, then make the edit.",
  '■ Created and edited `notes.md` · 2 steps',
  '    ● Created `notes.md`  +5',
  '    ● Edited `notes.md`  +1 -1',
  '| Edited. Checking the folder before I delete anything.'
]

// docs/design/reference/settled-C.png, top to bottom.
const SETTLED = [
  ...HEAD,
  '● Ran `ls -la && ls scratch`',
  '○ You allowed this once.',
  '● Ran `rm -rf /tmp/hermes-proto-work/scratch`',
  '| Done. I created `notes.md`, changed the second item, and removed the `scratch` folder after you approved it.',
  '✓ Done'
].join('\n')

describe('the errand as design C', () => {
  it('reads like the settled-C screenshot once the turn settles', () => {
    expect(outline(view(fold(story)))).toBe(SETTLED)
  })

  it('carries the live end on the folder listing, as the tool-running-C screenshot shows', () => {
    const running = momentWhere(state => {
      const activity = activityOf(state.content)
      if (state.content.run.state !== 'running' || activity.kind !== 'working') return false
      const item = state.content.run.turn.items[activity.item]
      return item?.kind === 'tool' && String(item.args.command).includes('ls -la')
    })
    expect(outline(view(running))).toBe([...HEAD, '◉ Running `ls -la && ls scratch`'].join('\n'))
  })

  it('asks before the delete, as the approval-C screenshot shows', () => {
    const asking = momentWhere(state => activityOf(state.content).kind === 'asking')
    expect(outline(view(asking))).toBe([
      ...HEAD,
      '● Ran `ls -la && ls scratch`',
      '◆ Run this command?',
      '    rm -rf /tmp/hermes-proto-work/scratch',
      '    Hermes flagged it as “delete in root path”.',
      "    [Run once] [Allow in this chat] [Always allow] [Don't run]"
    ].join('\n'))
  })

  it('pauses the live end when the link drops mid-turn', () => {
    const running = momentWhere(state => activityOf(state.content).kind === 'working')
    const dropped = reduce(running, { in: 'link.lost' })
    expect(outline(threadView(sessionOf(dropped, { state: 'connecting', attempt: 1 }, null))).split('\n').slice(-2)).toEqual([
      '● Writing `notes.md`',
      '◌ Paused while Highwing is disconnected.'
    ])
  })
})

describe('soundness of the errand view', () => {
  it.each(moments.map(({ beat }) => beat))('holds at beat %i, live, offline and catching up', beat => {
    const { state } = moments[beat]!
    const offline = reduce(state, { in: 'link.lost' })
    const catchingUp = reduce(offline, { in: 'attach' })
    expect(checkThread(view(state))).toEqual([])
    expect(checkThread(threadView(sessionOf(offline, { state: 'connecting', attempt: 1 }, null)))).toEqual([])
    expect(checkThread(view(catchingUp))).toEqual([])
  })

  it.each(Array.from({ length: story.frames.length }, (_, i) => i + 1))('holds after a drop after frame %i, and ends as settled-C', afterFrame => {
    const got = view(foldWithDrop(story, afterFrame, 3))
    expect(checkThread(got)).toEqual([])
    expect(outline(got)).toBe(SETTLED)
  })
})
