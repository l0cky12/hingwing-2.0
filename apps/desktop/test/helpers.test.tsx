import type { HelperId } from '@highwing/hermes/domain'
import type { HelperView, PlanEntryView, PlanView, ThreadNode, TurnView } from '@highwing/thread'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { HelperControls } from '../src/renderer/chat/Helpers'
import { Node, Turn } from '../src/renderer/chat/Thread'
import { NONE_OPEN, toggled } from '../src/renderer/chat/open'

type Press = () => void
interface Control { readonly name: string; readonly expanded: unknown; readonly disabled: boolean; readonly describedBy: unknown; readonly press: Press }

const textOf = (markup: string) => markup.replace(/<[^>]*>/g, '').replace(/&#x27;/g, "'")

function visibleButtons(node: ReactNode): Control[] {
  if (Array.isArray(node)) return node.flatMap(visibleButtons)
  if (!isValidElement(node)) return []
  const { type, props } = node as ReactElement<{ children?: ReactNode; onClick?: Press; 'aria-expanded'?: unknown; 'aria-describedby'?: unknown; disabled?: boolean }>
  if (typeof type === 'function') return visibleButtons((type as (props: unknown) => ReactNode)(props))
  const inside = visibleButtons(props.children)
  if (type !== 'button') return inside
  return [{ name: textOf(renderToStaticMarkup(node)), expanded: props['aria-expanded'], disabled: props.disabled === true, describedBy: props['aria-describedby'], press: props.onClick! }, ...inside]
}

function shown(node: ThreadNode, tone: 'live' | null = null, helpers: HelperControls | null = null) {
  let state = NONE_OPEN
  const props = () => ({ node, endTone: tone, elapsed: null, open: state, helpers, onAnswer: async () => undefined, onToggle: (key: string, byDefault = false) => { state = toggled(state, key, byDefault) } })
  return {
    markup: () => renderToStaticMarkup(<Node {...props()} />),
    buttons: (name: RegExp) => visibleButtons(Node(props())).filter(control => name.test(control.name)),
    button: (name: RegExp) => {
      const found = visibleButtons(Node(props())).filter(control => name.test(control.name))
      expect(found, `one button named ${name}`).toHaveLength(1)
      return found[0]!
    },
    settle: (openByDefault: boolean) => { if (node.kind === 'plan') node = { ...node, plan: { ...node.plan, openByDefault } } }
  }
}

const reasoning = (more: Partial<Extract<ThreadNode, { kind: 'reasoning' }>> = {}): ThreadNode =>
  ({ kind: 'reasoning', key: 't1/0', text: 'The disk is the likelier cause.\n\nCheck df first.', streaming: false, duration: '12 s', ...more })

const helperView = (more: Partial<HelperView> = {}): HelperView => ({
  goal: 'Check free space on the backup disk', stop: null, state: 'done', ended: null, now: null, count: 3, duration: '41 s',
  steps: [
    { kind: 'step', key: 't1/1/s0', title: [{ t: 'text', v: 'Ran ' }, { t: 'code', v: 'df -h' }], latest: false },
    { kind: 'step', key: 't1/1/s1', title: [{ t: 'text', v: 'Read ' }, { t: 'code', v: 'fstab' }], latest: true },
    { kind: 'helper', key: 't1/1/h2', goal: 'List old snapshots', state: 'working', more: 1 }
  ],
  summary: '/var/backups is 100% full.', ...more
})
const helper = (more: Partial<HelperView> = {}): ThreadNode => ({ kind: 'helper', key: 't1/1', helper: helperView(more) })

const entry = (id: string, text: string, state: PlanEntryView['state'], depth = 0): PlanEntryView => ({ key: `t1/2/e${id}`, text, state, depth })
const planView = (openByDefault: boolean): PlanView => ({
  done: 2, total: 3, cancelled: 1, openByDefault,
  entries: [entry('1', 'List the servers', 'done'), entry('2', 'Check each disk', 'doing'), entry('3', 'Check the load balancer', 'cancelled', 1), entry('4', 'Write it up', 'todo')]
})
const plan = (openByDefault: boolean): ThreadNode => ({ kind: 'plan', key: 't1/2', plan: planView(openByDefault) })

describe('a reasoning node', () => {
  it('is one button named by how long it thought, closed, with its text hidden', () => {
    const view = shown(reasoning())
    const button = view.button(/^Thought for 12 s$/)
    expect(button.expanded).toBe(false)
    expect(view.markup()).toMatch(/<p class="text"[^>]* hidden=""[^>]*>The disk is the likelier cause\./)
  })

  it('shows its text once pressed, and hides it again on a second press', () => {
    const view = shown(reasoning())
    view.button(/Thought/).press()
    expect(view.button(/Thought/).expanded).toBe(true)
    expect(view.markup()).not.toContain('hidden=""')
    view.button(/Thought/).press()
    expect(view.button(/Thought/).expanded).toBe(false)
    expect(view.markup()).toContain('hidden=""')
  })

  it('says Thinking while it streams and Thought when no duration is known', () => {
    expect(shown(reasoning({ streaming: true, duration: null })).button(/./).name).toBe('Thinking')
    expect(shown(reasoning({ duration: null })).button(/./).name).toBe('Thought')
  })

  it('carries the live end only when it holds it', () => {
    expect(shown(reasoning({ streaming: true, duration: null }), 'live').markup()).toMatch(/class="reasoning live streaming" data-end="live"/)
    expect(shown(reasoning()).markup()).not.toContain('data-end')
  })
})

describe('a helper node', () => {
  it('names its goal, step count and state, and shows no steps or summary while closed', () => {
    const view = shown(helper())
    const button = view.button(/Check free space/)
    expect(button.name).toBe('HelperCheck free space on the backup disk3 steps41 sdone')
    expect(button.expanded).toBe(false)
    expect(view.markup()).not.toMatch(/df -h|fstab|List old snapshots|100% full/)
  })

  it('shows its steps, its own helper and its summary once pressed, and not after a second press', () => {
    const view = shown(helper())
    view.button(/Check free space/).press()
    expect(view.button(/Check free space/).expanded).toBe(true)
    const open = textOf(view.markup())
    expect(open).toContain('Ran df -h')
    expect(open).toContain('Read fstab')
    expect(open).toMatch(/List old snapshots.*and 1 helper of its own/)
    expect(open).toContain("Helper's summary/var/backups is 100% full.")
    view.button(/Check free space/).press()
    expect(view.markup()).not.toContain('Ran ')
  })

  it('marks only the newest step as the latest, for screen readers', () => {
    const view = shown(helper())
    view.button(/Check free space/).press()
    expect(view.markup().match(/latest step/g)).toHaveLength(1)
    expect(view.markup()).toMatch(/<li class="latest"><span class="title"[^>]*>Read/)
  })

  it('tells a failed helper in words beside its title, and a queued one apart from a working one', () => {
    expect(shown(helper({ state: 'failed', ended: 'Timed out' })).button(/Check free/).name).toContain('Timed out')
    expect(shown(helper({ state: 'queued', now: [{ t: 'text', v: 'Waiting to start' }], steps: [], count: 0, duration: null })).button(/Check free/).name).toMatch(/waiting to start$/)
  })

  it('links a working helper to its now line, and drops the link once it is open', () => {
    const view = shown(helper({ state: 'working', duration: null, summary: null, now: [{ t: 'text', v: 'Started ' }, { t: 'code', v: 'du -sh' }] }), 'live')
    expect(view.markup()).toMatch(/aria-describedby="(now-[^"]*)".*id="\1" aria-live="polite">Started <code>du -sh<\/code>/)
    expect(view.markup()).toMatch(/class="helper working live" data-end="live"/)
    view.button(/Check free/).press()
    expect(view.markup()).not.toContain('aria-describedby')
    expect(view.markup()).toMatch(/aria-controls="(sub-[^"]*)".*id="\1"/)
  })
})

describe('a helper\'s Stop button', () => {
  const HELPER = 'sa-0-1' as HelperId
  const working = (more: Partial<HelperView> = {}) => helper({ stop: HELPER, state: 'working', duration: null, summary: null, ...more })
  const controls = (stopping: readonly HelperId[] = [], onStop: (id: HelperId) => void = () => {}): HelperControls => ({ stopping: new Set(stopping), onStop })

  it('sits beside a working helper the agent started, named for the helper it stops, and asks Hermes to stop that helper', () => {
    const asked: HelperId[] = []
    const view = shown(working(), null, controls([], id => asked.push(id)))
    const stop = view.button(/^Stop/)
    expect(stop).toMatchObject({ name: 'Stop helper', disabled: false })
    expect(view.markup()).toMatch(new RegExp(`<span class="title" id="${String(stop.describedBy)}"[^>]*>Check free space on the backup disk</span>`))
    expect(view.button(/^Helper/).name, 'the head button does not hold it').not.toContain('Stop')
    stop.press()
    expect(asked).toEqual([HELPER])
  })

  it('reads Stopping and cannot be pressed while the stop is on its way, and is pressable again once it is not', () => {
    expect(shown(working(), null, controls([HELPER])).button(/^Stop/)).toMatchObject({ name: 'Stopping helper', disabled: true })
    expect(shown(working(), null, controls(['sa-0-2' as HelperId])).button(/^Stop/)).toMatchObject({ name: 'Stop helper', disabled: false })
  })

  it('is not offered while the chat is not live, for a helper with nothing to stop, or once the helper has ended', () => {
    expect(shown(working()).buttons(/^Stop/)).toEqual([])
    expect(shown(working({ stop: null }), null, controls()).buttons(/^Stop/)).toEqual([])
    expect(shown(helper({ state: 'failed', ended: 'Stopped' }), null, controls([HELPER])).buttons(/^Stop/)).toEqual([])
  })
})

describe('a plan node', () => {
  it('counts its entries by what is done, and names each entry state as hidden text', () => {
    const view = shown(plan(true))
    expect(view.button(/Plan/).name).toBe('Plan2 of 3 done1 cancelled')
    const items = Array.from(view.markup().matchAll(/<span class="text"[^>]*>([^<]*)<\/span><span class="sr">([^<]*)<\/span>/g), ([, text, state]) => [text, state])
    expect(items).toEqual([['List the servers', 'done'], ['Check each disk', 'in progress'], ['Check the load balancer', 'cancelled'], ['Write it up', 'to do']])
    expect(view.markup()).toMatch(/<ul class="items"[^>]* aria-live="polite">/)
  })

  it('nests an entry under its parent', () => {
    expect(shown(plan(true)).markup()).toMatch(/Check each disk.*<ul><li class="cancelled">/s)
  })

  it('is open while its turn runs and closed once the turn has settled', () => {
    expect(shown(plan(true)).button(/Plan/).expanded).toBe(true)
    const settled = shown(plan(false))
    expect(settled.button(/Plan/).expanded).toBe(false)
    expect(settled.markup()).not.toContain('Check each disk')
  })

  it('closes on a press when it opened by itself, and opens on a press when it did not', () => {
    const live = shown(plan(true))
    live.button(/Plan/).press()
    expect(live.button(/Plan/).expanded).toBe(false)
    expect(live.markup()).not.toContain('Check each disk')
    live.button(/Plan/).press()
    expect(live.button(/Plan/).expanded).toBe(true)

    const settled = shown(plan(false))
    settled.button(/Plan/).press()
    expect(settled.button(/Plan/).expanded).toBe(true)
    expect(settled.markup()).toContain('Check each disk')
  })

  it('keeps what the reader chose when its turn settles', () => {
    const closed = shown(plan(true))
    closed.button(/Plan/).press()
    closed.settle(false)
    expect(closed.button(/Plan/).expanded).toBe(false)

    const reopened = shown(plan(true))
    reopened.button(/Plan/).press()
    reopened.button(/Plan/).press()
    reopened.settle(false)
    expect(reopened.button(/Plan/).expanded).toBe(true)

    const untouched = shown(plan(true))
    untouched.settle(false)
    expect(untouched.button(/Plan/).expanded).toBe(false)
  })

  it('shows a finished plan as finished', () => {
    const done: ThreadNode = { kind: 'plan', key: 't1/2', plan: { ...planView(false), done: 3, cancelled: 0 } }
    expect(shown(done).markup()).toMatch(/class="plan finished"/)
    expect(shown(plan(false)).markup()).not.toContain('finished')
  })
})

describe('a turn', () => {
  const turn = (end: TurnView['end']): TurnView => ({ key: 't1', time: null, request: 'Check the servers', attachments: [], rowId: null, tokens: null, reactions: null, pages: [], nodes: [plan(true)], end })
  const draw = (end: TurnView['end']) => renderToStaticMarkup((
    <Turn turn={turn(end)} open={NONE_OPEN} onToggle={() => {}} onAnswer={async () => undefined} canEdit={false} showsRegenerate={false} canRegenerate={false} canBranch={false} onEdit={() => {}} onRegenerate={() => {}} onBranch={() => {}} onNewChat={() => {}} versions={[]} onVersion={() => {}} canReact={false} onReact={() => {}} helpers={null} />
  ))

  it('is a live turn while its end is live, and not once it is done', () => {
    expect(draw({ kind: 'at', nodeKey: 't1/2', tone: 'live', elapsed: null })).toContain('class="turn live-turn"')
    expect(draw({ kind: 'tip', words: [{ t: 'text', v: 'Thinking' }], elapsed: null })).toContain('class="turn live-turn"')
    expect(draw({ kind: 'done', words: 'Done' })).toContain('class="turn"')
  })
})
