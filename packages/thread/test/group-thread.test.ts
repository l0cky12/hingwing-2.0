import type { Answering, GroupChat, GroupEvent, GroupId, GroupMember, MemberId } from '@highwing/hermes/domain'
import { describe, expect, it } from 'vitest'
import { groupThread, type GroupThreadView } from '../src/thread-view'

const PLAN = 'launch-plan' as GroupId
const seat = (id: string, handle = id): GroupMember => ({ id: id as MemberId, bot: id as GroupMember['bot'], handle, name: handle })
const MEMBERS = [seat('default', 'ada'), seat('sam'), seat('juno')]
const NAMES: Record<string, string> = { default: 'Ada', sam: 'Sam', juno: 'Juno' }
const nameOf = (member: GroupMember) => NAMES[member.id] ?? member.name
const CLOCK = { now: Date.UTC(2026, 10, 25, 11, 0), timeZone: 'UTC' }
const AT = Date.UTC(2026, 10, 25, 10, 42)

const said = (seq: number, text: string, at = AT): GroupEvent => ({ kind: 'said', seq, at, id: `user:${seq}`, text })
const reply = (seq: number, member: string, text: string, about = 1): GroupEvent => ({ kind: 'reply', seq, at: AT, member: member as MemberId, about: `user:${about}`, text })
const silent = (seq: number, member: string, why: 'failed' | 'superseded' | 'stopped', about = 1, detail: string | null = null): GroupEvent =>
  ({ kind: 'silent', seq, at: AT, member: member as MemberId, about: `user:${about}`, why, detail })
const thinking = (member: string, doing: Answering['doing'] = 'thinking'): Answering => ({ member: member as MemberId, doing, tool: null })
const read = (events: readonly GroupEvent[], more: Partial<Extract<GroupChat, { at: 'read' }>> = {}): GroupChat =>
  ({ group: PLAN, at: 'read', name: 'Launch plan', members: MEMBERS, events, earlier: false, answering: [], sending: [], ...more })
const thread = (view: GroupThreadView) => (view.show === 'thread' ? view : null)
const drawn = (view: GroupThreadView) => thread(view)?.turns.map(turn => [turn.request, ...turn.items.map(item => (item.kind === 'reply' ? `${nameOf(item.member)}: ${item.text}` : item.words))])

describe('an open group chat', () => {
  it("draws each message with its members' replies under it, and who is answering now at its end", () => {
    const view = groupThread(read([said(1, 'Ship it?'), reply(2, 'default', 'Notes.'), reply(3, 'sam', 'Close.'), reply(4, 'juno', '@sam start staging?')], { answering: [thinking('sam')] }), CLOCK, nameOf)
    expect(drawn(view)).toEqual([['Ship it?', 'Ada: Notes.', 'Sam: Close.', 'Juno: @sam start staging?']])
    expect(thread(view)).toMatchObject({
      name: 'Launch plan', live: 'Sam is thinking', stoppable: true,
      busy: 'Sam is still answering. If you send now, Sam’s reply won’t be posted.', turns: [{ time: 'Today 10:42' }]
    })
  })

  it('puts a reply a newer message overtook under the message it answered, in words that say it was not posted', () => {
    const view = groupThread(read([said(1, 'Ship Thursday?'), said(2, 'Or Friday?'), silent(3, 'default', 'superseded'), reply(4, 'default', 'Friday.', 2)]), CLOCK, nameOf)
    expect(drawn(view)).toEqual([['Ship Thursday?', 'Ada’s reply wasn’t posted, because a newer message came first.'], ['Or Friday?', 'Ada: Friday.']])
  })

  it('says a member was stopped or could not answer, the second as an error', () => {
    const view = groupThread(read([said(1, 'Ship it?'), silent(2, 'sam', 'stopped'), silent(3, 'juno', 'failed', 1, 'No model is set up.'), silent(4, 'default', 'failed')]), CLOCK, nameOf)
    expect(thread(view)?.turns[0]?.items).toMatchObject([
      { words: 'Sam was stopped.', tone: 'quiet' }, { words: 'Juno couldn’t answer: No model is set up.', tone: 'error' }, { words: 'Ada couldn’t answer.', tone: 'error' }
    ])
  })

  it('draws a message Hermes has not logged after the thread, and names several members answering at once', () => {
    const view = groupThread(read([], { sending: [{ key: 'k1', text: 'Anyone?' }], answering: [thinking('default'), thinking('juno', 'working'), thinking('sam', 'waiting')] }), CLOCK, nameOf)
    expect(thread(view)?.turns).toEqual([{ key: 'k1', time: null, request: 'Anyone?', sending: true, items: [] }])
    expect(thread(view)).toMatchObject({ live: 'Ada and Juno are thinking', busy: 'Ada and Juno are still answering. If you send now, their replies won’t be posted.' })
  })

  it('shows Stop only while a member has not been reached by one, and nothing live at rest', () => {
    expect(thread(groupThread(read([said(1, 'Ship it?')], { answering: [thinking('sam', 'stopping')] }), CLOCK, nameOf))).toMatchObject({ stoppable: false, live: 'Sam is stopping' })
    expect(thread(groupThread(read([said(1, 'Ship it?')]), CLOCK, nameOf))).toMatchObject({ stoppable: false, live: null, busy: null })
  })

  it('draws a line whose message is older than the window first, under no message, and draws the live end with no message at all', () => {
    expect(drawn(groupThread(read([reply(5, 'sam', 'Late.', 1), said(6, 'Next?')], { earlier: true }), CLOCK, nameOf))).toEqual([[null, 'Sam: Late.'], ['Next?']])
    expect(drawn(groupThread(read([said(6, 'Next?'), reply(7, 'sam', 'Late.', 1)], { earlier: true }), CLOCK, nameOf))).toEqual([[null, 'Sam: Late.'], ['Next?']])
    expect(thread(groupThread(read([], { answering: [thinking('sam')] }), CLOCK, nameOf))?.turns).toMatchObject([{ request: null, items: [] }])
  })

  it('waits for Hermes, and says so plainly of a group it no longer has', () => {
    expect(groupThread(undefined, CLOCK, nameOf)).toEqual({ show: 'loading' })
    expect(groupThread({ group: PLAN, at: 'loading' }, CLOCK, nameOf)).toEqual({ show: 'loading' })
    expect(groupThread({ group: PLAN, at: 'missing' }, CLOCK, nameOf)).toEqual({ show: 'note', words: 'This group chat isn’t on this Hermes any more.' })
  })
})
