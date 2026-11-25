import type { SessionId } from '@highwing/hermes/domain'
import { describe, expect, it } from 'vitest'
import { chatLink, chatLinkIn, parseChatLink } from '../src/chat-link'

describe('parseChatLink', () => {
  it.each([
    ['highwing://chat/local-0001', 'local-0001'],
    ['highwing://chat/local-832ffad3cb49cd0284d5dd4cb3a8790dafef42b38a259dc1d93e2bc962b80666', 'local-832ffad3cb49cd0284d5dd4cb3a8790dafef42b38a259dc1d93e2bc962b80666'],
    ['highwing://chat/chat-research-1', 'chat-research-1'],
    ['highwing://chat/local-0001-compressed', 'local-0001-compressed']
  ])('reads %s', (text, id) => {
    expect(parseChatLink(text)).toBe(id)
  })

  it.each([
    'highwing://other/x', 'highwing://chat/', 'highwing://chat', 'highwing://chat/a/b', 'highwing://chat/..', 'highwing://chat/a/../b', 'highwing://chat/a%2Fb',
    'highwing://chat/.hidden', 'https://x', 'https://chat/local-0001', 'hermes://chat/local-0001', 'highwing:chat/local-0001', 'HIGHWING://chat/local-0001',
    'highwing://chat/local-0001?send=hi', 'highwing://chat/local-0001#x', 'highwing://me@chat/local-0001', 'highwing://chat:1/local-0001', 'highwing://chat/local-0001/',
    `highwing://chat/${'a'.repeat(129)}`, '', 'local-0001'
  ])('names nothing for %s', text => {
    expect(parseChatLink(text)).toBeNull()
  })

  it('reads back every link it writes', () => {
    for (const id of ['local-0001', 'chat-x-1', 'branch-x-1', 'A_b-9'] as SessionId[]) expect(parseChatLink(chatLink(id))).toBe(id)
  })
})

describe('chatLinkIn', () => {
  it('finds the link wherever Chromium put it on the command line', () => {
    expect(chatLinkIn(['/usr/lib/highwing/highwing', '--ozone-platform-hint=auto', 'highwing://chat/local-0001', '--allow-file-access-from-files'])).toBe('local-0001')
  })

  it('names nothing for a command line with no link, or a malformed one', () => {
    expect(chatLinkIn(['/usr/lib/highwing/highwing', '--ozone-platform-hint=auto'])).toBeNull()
    expect(chatLinkIn(['highwing', 'highwing://chat/a/../b'])).toBeNull()
  })
})
