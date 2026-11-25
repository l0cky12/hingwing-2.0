import { describe, expect, it } from 'vitest'
import type { Bot, BotId } from '../src/domain/bots'
import type { Link, SessionId } from '../src/domain/session'
import { relayBook } from '../src/relay'
import { settle } from '../src/testing/clock'
import type { CanonicalBotDeliverResult } from '../src/wire/contract.generated'
import { Offline, RpcRefusal } from '../src/wire/link'
import { parseDelivery } from '../src/wire/parse'

const receipt = (more: Partial<CanonicalBotDeliverResult>): CanonicalBotDeliverResult =>
  ({ status: 'settled', delivery_id: 'a'.repeat(32), profile_home: '/profiles/rae', session_id: 's', message: 'hi', ...more })

describe('parseDelivery', () => {
  it('is the reply of a settled delivery, as it was written', () => {
    expect(parseDelivery(receipt({ reply: 'Done.\n\n- one' }), 'Rae')).toEqual({ s: 'answered', reply: 'Done.\n\n- one' })
  })

  it.each([
    ['a settled delivery with a blank reply', receipt({ reply: ' \n' }), 'Rae sent back an empty reply.'],
    ['a settled delivery with no reply', receipt({}), 'Rae sent back an empty reply.'],
    ['a target that was not running', receipt({ status: 'failed', refused: true, reason: 'runtime_unavailable', error: 'no gateway for rae' }), "Rae is offline, so it didn't get your message."],
    ['a target that went away', receipt({ status: 'failed', reason: 'runtime_offline' }), "Rae is offline, so it didn't get your message."],
    ['a turn that failed with words', receipt({ status: 'failed', error: 'The model refused the request', reason: 'turn_failed' }), "Rae couldn't answer: The model refused the request"],
    ['a turn that failed with a reason only', receipt({ status: 'failed', reason: 'turn_failed' }), "Rae couldn't answer: turn_failed"],
    ['a turn that failed and said nothing', receipt({ status: 'failed' }), "Rae couldn't answer."],
    ['a stopped turn', receipt({ status: 'cancelled' }), "Rae's turn was stopped before it answered."],
    ['a delivery still queued when the call returned', receipt({ status: 'queued' }), "Rae got your message, but Hermes didn't pass back an answer."],
    ['a status Highwing does not know', receipt({ status: 'toString', reply: 'Done.' }), "Rae got your message, but Hermes didn't pass back an answer."],
    ['a reply that is no receipt', null as unknown as CanonicalBotDeliverResult, "Rae got your message, but Hermes didn't pass back an answer."]
  ])('says in words what became of %s', (_, reply, words) => {
    expect(parseDelivery(reply, 'Rae')).toEqual({ s: 'failed', words })
  })
})

describe('a message handed to another bot', () => {
  const SESSION = 'session-1' as SessionId
  const RAE: Bot = { id: 'rae' as BotId, name: 'Rae', preview: null, description: null, tone: 'umber', picture: false }

  async function failedWith(error: Error, link: Link) {
    const book = relayBook({ link, call: () => Promise.reject(error), as: () => ({ link, call: () => Promise.reject(error) }) }, () => {})
    book.send(SESSION, null, RAE, 'Ask @Rae')
    await settle()
    return book.desk.bySession[SESSION]?.map(relay => relay.state)
  }
  const ONLINE: Link = { state: 'online' }
  const WAITING: Link = { state: 'waiting', attempt: 1, retryAt: 0, why: 'dropped', message: 'Reconnecting to Hermes.' }

  it.each([
    ['Hermes no longer has the bot', new RpcRefusal(4092, 'unknown_profile', "no profile 'rae' on this gateway"), ONLINE, "Rae isn't on this Hermes any more, so it didn't get your message."],
    ['the bot is not running', new RpcRefusal(5094, 'runtime_unavailable', 'connect failed'), ONLINE, "Rae is offline, so it didn't get your message."],
    ['Hermes refuses for another reason', new RpcRefusal(4001, 'queue_full', 'The queue is full'), ONLINE, "Rae couldn't take your message: The queue is full"],
    ['no answer came before the deadline', new Offline('bot_relay.deliver got no reply in 1500000 ms'), ONLINE, "Rae didn't answer in 25 minutes."],
    ['the socket closed first', new Offline('The socket closed before the gateway replied.'), WAITING, 'The connection to Hermes dropped before Rae answered.']
  ])('fails in words when %s', async (_, error, link, words) => {
    expect(await failedWith(error, link)).toEqual([{ s: 'failed', words }])
  })
})
