import type { PathMatch } from '@highwing/hermes/domain'
import { describe, expect, it } from 'vitest'
import { pathAsker, type Timer } from '../src/renderer/composer/paths'

const NOTES: readonly PathMatch[] = [{ path: 'notes.md', folder: false }]
const NOTEBOOKS: readonly PathMatch[] = [{ path: 'notebooks/', folder: true }]

function stage() {
  let now = 0
  let pending: { at: number; task: () => void; id: number } | null = null
  let ids = 0
  const timer: Timer = {
    set: (task, ms) => (pending = { at: now + ms, task, id: ++ids }).id,
    clear: handle => { if (pending?.id === handle) pending = null }
  }
  const asked: { word: string; reply: (found: readonly PathMatch[]) => void; fail: () => void }[] = []
  const asker = pathAsker(
    word => new Promise((resolve, reject) => void asked.push({ word, reply: resolve, fail: () => reject(new Error('refused')) })),
    timer
  )
  const wait = (ms: number) => {
    now += ms
    if (pending !== null && pending.at <= now) {
      const { task } = pending
      pending = null
      task()
    }
  }
  const settle = () => new Promise(resolve => setTimeout(resolve, 0))
  return { asker, asked, wait, settle }
}

describe('the path asker', () => {
  it('asks once for a word that held still, however many were typed before it', () => {
    const { asker, asked, wait } = stage()
    asker.want('@n')
    wait(50)
    asker.want('@no')
    wait(100)
    expect(asked).toEqual([])
    wait(20)
    expect(asked.map(call => call.word)).toEqual(['@no'])
  })

  it('shows the reply for the word asked', async () => {
    const { asker, asked, wait, settle } = stage()
    asker.want('@not')
    wait(120)
    asked[0]!.reply(NOTES)
    await settle()
    expect(asker.files().matches).toEqual(NOTES)
  })

  it('ignores a reply for an older word that arrives after the newer one', async () => {
    const { asker, asked, wait, settle } = stage()
    asker.want('@not')
    wait(120)
    asker.want('@notes')
    wait(120)
    expect(asked.map(call => call.word)).toEqual(['@not', '@notes'])
    asked[1]!.reply(NOTES)
    await settle()
    asked[0]!.reply(NOTEBOOKS)
    await settle()
    expect(asker.files().matches).toEqual(NOTES)
  })

  it('ignores a reply for a word that was typed past before its ask was sent', async () => {
    const { asker, asked, wait, settle } = stage()
    asker.want('@not')
    wait(120)
    asker.want('@notes')
    asked[0]!.reply(NOTEBOOKS)
    await settle()
    expect(asker.files().matches).toEqual([])
  })

  it('holds the last matches while a newer word waits, and clears them when no word is wanted', async () => {
    const { asker, asked, wait, settle } = stage()
    asker.want('@not')
    wait(120)
    asked[0]!.reply(NOTEBOOKS)
    await settle()
    asker.want('@notebooks/')
    expect(asker.files(), 'the held rows still name the word they answer').toEqual({ word: '@not', matches: NOTEBOOKS })
    wait(120)
    asked[1]!.reply(NOTES)
    await settle()
    expect(asker.files()).toEqual({ word: '@notebooks/', matches: NOTES })
    asker.want(null)
    expect(asker.files().matches).toEqual([])
  })

  it('asks nothing for an @ alone, and clears what it held', async () => {
    const { asker, asked, wait, settle } = stage()
    asker.want('@not')
    wait(120)
    asked[0]!.reply(NOTES)
    await settle()
    asker.want('@')
    wait(500)
    expect(asked).toHaveLength(1)
    expect(asker.files().matches).toEqual([])
  })

  it('shows no matches when Hermes refuses, and does not ask again for the same word', async () => {
    const { asker, asked, wait, settle } = stage()
    asker.want('@not')
    wait(120)
    asked[0]!.reply(NOTES)
    await settle()
    asker.want('@note')
    wait(120)
    asked[1]!.fail()
    await settle()
    expect(asker.files().matches).toEqual([])
    asker.want('@note')
    wait(500)
    expect(asked).toHaveLength(2)
  })

  it('drops a pending ask and a late reply once disposed', async () => {
    const { asker, asked, wait, settle } = stage()
    asker.want('@not')
    wait(120)
    asker.dispose()
    asked[0]!.reply(NOTES)
    await settle()
    expect(asker.files().matches).toEqual([])
    asker.want('@zzz')
    asker.dispose()
    wait(500)
    expect(asked).toHaveLength(1)
  })

  it('tells a listener when the matches change', async () => {
    const { asker, asked, wait, settle } = stage()
    let heard = 0
    const off = asker.subscribe(() => heard++)
    asker.want('@not')
    wait(120)
    asked[0]!.reply(NOTES)
    await settle()
    expect(heard).toBe(1)
    off()
    asker.want(null)
    expect(heard).toBe(1)
  })
})
