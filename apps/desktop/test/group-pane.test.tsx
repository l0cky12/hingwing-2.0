import type { BotId, GroupChat, GroupId, Groups, Link, MemberId, OpenChat } from '@highwing/hermes/domain'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fact, listed } from './support/bots'

const topics = vi.hoisted(() => ({ values: {} as Record<string, unknown> }))

vi.mock('react', async original => ({
  ...(await original<typeof import('react')>()),
  useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read()
}))
vi.mock('../src/renderer/store', () => ({
  Epoch: {},
  run: async () => ({ ok: true, value: undefined }),
  useTopic: (topic: string | null) => (topic === null ? undefined : topics.values[topic])
}))

const { GroupPane } = await import('../src/renderer/groups/GroupPane')
const { TopBar } = await import('../src/renderer/chrome/Chrome')

const PLAN = 'launch-plan' as GroupId
const seat = (id: string, handle = id) => ({ id: id as MemberId, bot: id as BotId, handle, name: handle })
const MEMBERS = [seat('default', 'ada'), seat('sam'), seat('juno')]
const BOTS = listed(fact('default', 'Ada', { isDefault: true }), fact('sam', 'Sam'), fact('juno', 'Juno'), fact('rae', 'Rae'))
const SHOWN = { kind: 'group', group: PLAN, over: 'default' as BotId } as const
const OPEN: OpenChat = { shown: SHOWN, opening: null, missing: null }
const GROUPS = (driver = true): Groups => ({ state: 'listed', driver, seatable: null, rows: [{ id: PLAN, name: 'Launch plan', members: MEMBERS, answering: [] }] })
const AT = Date.UTC(2026, 10, 25, 10, 42)
const CHAT: GroupChat = {
  group: PLAN, at: 'read', name: 'Launch plan', members: MEMBERS, earlier: false, sending: [],
  events: [
    { kind: 'said', seq: 1, at: AT, id: 'user:1', text: 'Can we ship the login fix on Thursday?' },
    { kind: 'reply', seq: 2, at: AT, member: 'default' as MemberId, about: 'user:1', text: 'I’ll draft the release notes once the date is set.' },
    { kind: 'reply', seq: 4, at: AT, member: 'sam' as MemberId, about: 'user:1', text: 'Close.' },
    { kind: 'reply', seq: 6, at: AT, member: 'juno' as MemberId, about: 'user:1', text: 'Thursday works. @sam can you start that staging run now? Mail ops@sam.dev.' }
  ],
  answering: [{ member: 'sam' as MemberId, doing: 'thinking', tool: null }]
}
const ONLINE: Link = { state: 'online' }

const pane = () => renderToStaticMarkup(<GroupPane shown={SHOWN} />)
const tagOf = (html: string, pattern: RegExp) => pattern.exec(html)?.[0] ?? ''
const attr = (tag: string, name: string) => new RegExp(` ${name}="([^"]*)"`).exec(tag)?.[1]

beforeEach(() => {
  topics.values = { open: OPEN, bots: BOTS, groups: GROUPS(), groupChat: CHAT, link: ONLINE, relay: { supported: true, bySession: {} }, slash: [] }
})

describe('an open group chat', () => {
  it("draws the request, then each member's reply with its avatar and name over Literata prose, as one thread with Sam thinking at its end", () => {
    const html = pane()
    expect(html).toMatch(/<article class="turn group-turn">(<p class="when">[^<]*<\/p>)?<p class="request">Can we ship the login fix on Thursday\?<\/p><div class="thread">/)
    const replies = Array.from(html.matchAll(/<div class="said-by" role="group" aria-label="(\w+)"><p class="relay-from"><span class="avatar[^"]*"[^>]*>(\w)<\/span><span>(\w+)<\/span><\/p><div class="prose">/g), ([, label, letter, name]) => `${label} ${letter} ${name}`)
    expect(replies).toEqual(['Ada A Ada', 'Sam S Sam', 'Juno J Juno'])
    expect(html).toMatch(/<div class="tip thinking" role="status"><span class="glyph"><\/span>Sam is thinking<\/div><\/div><\/article>/)
  })

  it("sets a member's @handle apart in a reply, and nothing that only looks like one", () => {
    const html = pane()
    expect(html).toContain('Thursday works. <span class="mention">@sam</span> can you start that staging run now? Mail ops@sam.dev.')
  })

  it('writes to the group from the chat\'s own composer, with Stop before Send and the busy line under it, and no attachments', () => {
    const html = pane()
    const box = tagOf(html, /<textarea[^>]*>/)
    expect(attr(box, 'placeholder')).toBe('Message the group, or type @ to ask specific bots')
    expect(attr(box, 'aria-label')).toBe('Message Launch plan')
    expect(html).toContain(`<p class="busy" id="${attr(box, 'aria-describedby')}">Sam is still answering. If you send now, Sam’s reply won’t be posted.</p>`)
    expect(html).toMatch(/<button type="button" class="stop">Stop<\/button><button type="submit">Send<\/button>/)
    expect(html, 'a group takes no attachments, so it offers no paperclip').not.toContain('class="clip"')
  })

  it("blocks Send in words while Hermes isn't running group chats", () => {
    topics.values = { ...topics.values, groups: GROUPS(false), groupChat: { ...CHAT, answering: [] } }
    const html = pane()
    expect(html).toContain('>Hermes isn&#x27;t running group chats right now.</p>')
    expect(tagOf(html, /<button type="submit"[^>]*>/)).toContain('disabled')
  })

  it('names the group and its members in the top bar, with no New chat and no Copy link', () => {
    const html = renderToStaticMarkup(<TopBar target={null} settingsButton={{ current: null }} onOpenTasks={() => {}} />)
    expect(html).toMatch(/<h1><span class="brand">Hermes<\/span> Launch plan<\/h1><span class="members"><span class="stack" aria-hidden="true">(<span class="avatar[^>]*>[ASJ]<\/span>){3}<\/span>Ada, Sam and Juno<\/span>/)
    expect(html).not.toMatch(/New chat|Copy link/)
  })

  it("draws nothing of another group's thread pushed before this one's", () => {
    topics.values = { ...topics.values, groupChat: { ...CHAT, group: 'standup' as GroupId } }
    expect(pane()).toMatch(/<main id="scroll"><div id="transcript"><\/div><\/main>/)
  })
})
