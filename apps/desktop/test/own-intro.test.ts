import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DONE, DUE, EXAMPLES, OFF } from '../src/intro'
import { INTRO, ownIntro } from '../src/main/intro'

const emptyDir = () => mkdtempSync(join(tmpdir(), 'highwing-intro-'))
const text = (dir: string) => readFileSync(join(dir, INTRO.file), 'utf8')

describe('the intro on disk', () => {
  it('arms only from off, then keeps the requests until a send finishes them', async () => {
    const dir = emptyDir()
    const owner = await ownIntro(dir)
    expect(owner.intro.get()).toBe(OFF)
    await owner.apply({ do: 'examples' })
    expect(owner.intro.get()).toBe(OFF)

    await owner.armIntro()
    expect(owner.intro.get()).toBe(DUE)
    expect(text(dir)).toBe('{"version":1,"intro":"due"}\n')
    expect((await ownIntro(dir)).intro.get()).toBe(DUE)
    writeFileSync(join(dir, INTRO.file), 'marker')
    await owner.armIntro()
    expect(text(dir)).toBe('marker')
    expect(owner.intro.get()).toBe(DUE)

    await owner.apply({ do: 'examples' })
    expect(owner.intro.get()).toBe(EXAMPLES)
    expect(JSON.parse(text(dir))).toEqual({ version: 1, intro: 'examples' })
    await owner.apply({ do: 'done' })
    expect(owner.intro.get()).toBe(DONE)
    expect(JSON.parse(text(dir))).toEqual({ version: 1, intro: 'done' })
    writeFileSync(join(dir, INTRO.file), 'marker')
    await owner.armIntro()
    expect(text(dir)).toBe('marker')
    expect(owner.intro.get()).toBe(DONE)
  })

  it.each([
    ['no file', null],
    ['off written by hand', '{"version":1,"intro":"off"}\n'],
    ['a later version', '{"version":2,"intro":"due"}\n'],
    ['a phase this build does not have', '{"version":1,"intro":"later"}\n']
  ])('starts off from %s', async (_what, content) => {
    const dir = emptyDir()
    if (content !== null) writeFileSync(join(dir, INTRO.file), content)
    expect((await ownIntro(dir)).intro.get()).toBe(OFF)
  })

  it('stays off when the arm cannot be written, and a later arm still can', async () => {
    const dir = emptyDir()
    const owner = await ownIntro(dir)
    rmSync(dir, { recursive: true })
    await expect(owner.armIntro()).rejects.toThrow()
    expect(owner.intro.get()).toBe(OFF)
    mkdirSync(dir)
    await owner.armIntro()
    expect(owner.intro.get()).toBe(DUE)
    expect(JSON.parse(text(dir))).toEqual({ version: 1, intro: 'due' })
  })
})
