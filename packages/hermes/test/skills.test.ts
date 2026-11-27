import { describe, expect, it } from 'vitest'
import type { BotId } from '../src/domain/bots'
import type { SkillLibrary } from '../src/domain/skills'
import { openHermes } from '../src/hub'
import { manualClock } from '../src/testing/clock'
import { scriptedDialer, type Fixture } from '../src/testing/fixture'
import { descriptionOf } from '../src/wire/parse'
import { callsIn, WITH_BOTS } from './support/errand'

const md = (name: string, description: string) => `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`
const SKILLS = [
  { name: 'triage-inbox', description: 'Sort new issues by area.', body: md('triage-inbox', 'Sort new issues by area.') },
  { name: 'weekly-report', description: 'not what the catalog would say', body: md('weekly-report', 'Summarize the week.'), enabled: false },
  { name: 'release-notes', description: 'Write release notes.', body: md('release-notes', 'Write release notes.') },
  { name: 'hermes-agent', description: 'Use Hermes itself.', body: md('hermes-agent', 'Use Hermes itself.') }
]
const RESEARCH = [{ name: 'sources', description: 'Cite sources.', body: md('sources', 'Cite sources.'), enabled: false }]
const WITH_SKILLS: Fixture = { ...WITH_BOTS, header: { ...WITH_BOTS.header, skills: { default: SKILLS, research: RESEARCH } } }

async function launched(fixture: Fixture) {
  const clock = manualClock()
  const script = scriptedDialer(fixture, { clock })
  const hermes = openHermes({ dial: script, clock, client: { name: 'highwing-test', version: '0.0.0' } })
  await clock.advance(0)
  const calls = (method: string) => callsIn(script.received).filter(call => call.method === method)
  const seen: SkillLibrary[] = []
  const watch = () => hermes.watchSkills(library => seen.push(library))
  return { clock, hermes, calls, seen, watch }
}

describe('the skills library', () => {
  it("lists every skill of the open bot by name, with the catalog's description, or its SKILL.md's for one the catalog skips", async () => {
    const { clock, seen, watch } = await launched(WITH_SKILLS)
    watch()
    await clock.advance(0)
    expect(seen.at(-1)).toEqual({
      state: 'listed', bot: 'default', skills: [
        { name: 'hermes-agent', description: 'Use Hermes itself.', enabled: true },
        { name: 'release-notes', description: 'Write release notes.', enabled: true },
        { name: 'triage-inbox', description: 'Sort new issues by area.', enabled: true },
        { name: 'weekly-report', description: 'Summarize the week.', enabled: false }
      ]
    })
  })

  it('asks Hermes nothing while no window watches it', async () => {
    const { clock, calls } = await launched({ ...WITH_SKILLS, header: { ...WITH_SKILLS.header, skillsElsewhere: { profile: 'default', name: 'triage-inbox', enabled: false, afterMs: 0 } } })
    await clock.advance(5000)
    expect([...calls('profiles.describe'), ...calls('learning.detail')]).toEqual([])
  })

  it("turns a skill on by sending the bot's whole disabled list without it, and the library shows it on", async () => {
    const { clock, hermes, calls, seen, watch } = await launched(WITH_SKILLS)
    watch()
    await clock.advance(0)
    expect(await hermes.run({ do: 'setSkill', bot: null, name: 'weekly-report', enabled: true })).toEqual({ ok: true, value: undefined })
    expect(calls('profiles.configure')).toEqual([{ method: 'profiles.configure', params: { name: 'default', disabled_skills: [] } }])
    expect(await hermes.run({ do: 'setSkill', bot: null, name: 'release-notes', enabled: false })).toEqual({ ok: true, value: undefined })
    expect(calls('profiles.configure').at(-1)).toEqual({ method: 'profiles.configure', params: { name: 'default', disabled_skills: ['release-notes'] } })
    await clock.advance(0)
    const last = seen.at(-1)
    expect(last?.state === 'listed' && last.skills.map(({ name, enabled }) => [name, enabled])).toEqual([['hermes-agent', true], ['release-notes', false], ['triage-inbox', true], ['weekly-report', true]])
  })

  it('refuses a skill Hermes keeps on, though Hermes says it saved the list', async () => {
    const { hermes, calls } = await launched(WITH_SKILLS)
    expect(await hermes.run({ do: 'setSkill', bot: null, name: 'hermes-agent', enabled: false }))
      .toEqual({ ok: false, refusal: { kind: 'rejected', message: 'Hermes kept hermes-agent on.' } })
    expect(calls('profiles.configure')).toEqual([{ method: 'profiles.configure', params: { name: 'default', disabled_skills: ['weekly-report', 'hermes-agent'] } }])
  })

  it('reads the list again when Hermes says skills changed elsewhere', async () => {
    const { clock, seen, watch } = await launched({ ...WITH_SKILLS, header: { ...WITH_SKILLS.header, skillsElsewhere: { profile: 'default', name: 'triage-inbox', enabled: false, afterMs: 1000 } } })
    watch()
    await clock.advance(0)
    const before = seen.at(-1)
    expect(before?.state === 'listed' && before.skills.find(skill => skill.name === 'triage-inbox')?.enabled).toBe(true)
    await clock.advance(1000)
    const after = seen.at(-1)
    expect(after?.state === 'listed' && after.skills.find(skill => skill.name === 'triage-inbox')?.enabled).toBe(false)
  })

  it("answers a skill's SKILL.md, and Hermes's refusal for one it does not have", async () => {
    const { hermes } = await launched(WITH_SKILLS)
    expect(await hermes.run({ do: 'skillText', bot: null, name: 'release-notes' })).toEqual({ ok: true, value: SKILLS[2]?.body })
    expect(await hermes.run({ do: 'skillText', bot: null, name: 'nothing' })).toEqual({ ok: false, refusal: { kind: 'rejected', message: 'Hermes has no SKILL.md for nothing.' } })
  })

  it("never shows the default bot's SKILL.md for another bot's skill, since Hermes reads only its own profile's", async () => {
    const { clock, hermes, calls, seen, watch } = await launched(WITH_SKILLS)
    watch()
    await hermes.run({ do: 'open', ref: { kind: 'bot', bot: 'research' as BotId } })
    await clock.advance(0)
    expect(seen.at(-1)).toEqual({ state: 'listed', bot: 'research', skills: [{ name: 'sources', description: '', enabled: false }] })
    expect(await hermes.run({ do: 'skillText', bot: 'research' as BotId, name: 'release-notes' }))
      .toEqual({ ok: false, refusal: { kind: 'unsupported', message: "This Hermes can show only the default bot's SKILL.md files." } })
    expect(calls('learning.detail').map(call => call.params), 'learning.detail takes only an id, and Hermes refuses any other key').toEqual([{ id: 'weekly-report' }])
  })

  it('keeps both of two switches moved at once, since each write replaces the whole off list', async () => {
    const { clock, hermes, seen, watch } = await launched(WITH_SKILLS)
    watch()
    await clock.advance(0)
    const both = await Promise.all([
      hermes.run({ do: 'setSkill', bot: null, name: 'release-notes', enabled: false }),
      hermes.run({ do: 'setSkill', bot: null, name: 'triage-inbox', enabled: false })
    ])
    expect(both).toEqual([{ ok: true, value: undefined }, { ok: true, value: undefined }])
    await clock.advance(0)
    const last = seen.at(-1)
    expect(last?.state === 'listed' && last.skills.filter(skill => !skill.enabled).map(skill => skill.name)).toEqual(['release-notes', 'triage-inbox', 'weekly-report'])
  })

  it('says why when this Hermes cannot list skills', async () => {
    const { clock, seen, watch } = await launched({ ...WITH_BOTS, header: { ...WITH_BOTS.header, reach: 'profile' } })
    watch()
    await clock.advance(0)
    expect(seen.at(-1)).toMatchObject({ state: 'failed', message: "This Hermes can't list skills from Highwing." })
  })
})

describe('descriptionOf', () => {
  it('reads a plain, a quoted and a folded description, and none from a file without frontmatter', () => {
    expect(descriptionOf('---\nname: a\ndescription: Plain words.\n---\nbody')).toBe('Plain words.')
    expect(descriptionOf('---\ndescription: "Quoted: words."\n---\n')).toBe('Quoted: words.')
    expect(descriptionOf('---\ndescription: >\n  Folded over\n  two lines.\nname: b\n---\n')).toBe('Folded over two lines.')
    expect(descriptionOf('# No frontmatter\ndescription: not this')).toBe('')
  })
})
