import { describe, expect, it } from 'vitest'
import { APPROVAL_MODES } from '../src/domain/session'
import { APPROVAL_WORDS, asksOf, BOT_TEMPLATES, personaStart, scheduleWords, TEMPLATE_TOOLSETS, timeWords, toolWords } from '../src/domain/bot-templates'

const template = (id: string) => BOT_TEMPLATES.find(item => item.id === id)!

describe('the bot templates', () => {
  it('offers the three approved templates, each with its own id and name', () => {
    expect(BOT_TEMPLATES.map(item => [item.id, item.name])).toEqual([
      ['bot-builder', 'Bot Builder'], ['deep-researcher', 'Deep Researcher'], ['nightly-repo-auditor', 'Nightly Repo Auditor']
    ])
    expect(new Set(BOT_TEMPLATES.map(item => item.id)).size).toBe(BOT_TEMPLATES.length)
  })

  it('turns on only toolsets Hermes has, each once, and approves in a mode Hermes has', () => {
    for (const item of BOT_TEMPLATES) {
      expect(new Set(item.toolsets).size, item.id).toBe(item.toolsets.length)
      for (const toolset of item.toolsets) expect(TEMPLATE_TOOLSETS, `${item.id} ${toolset}`).toContain(toolset)
      expect(APPROVAL_MODES).toContain(item.approval)
    }
  })

  it('gives each template the tools and approval mode the user approved', () => {
    expect([template('bot-builder').toolsets, template('bot-builder').approval]).toEqual([['terminal', 'file', 'clarify', 'skills', 'todo'], 'manual'])
    expect([template('deep-researcher').toolsets, template('deep-researcher').approval]).toEqual([['web', 'browser', 'delegation', 'file', 'todo', 'memory', 'clarify'], 'smart'])
    expect([template('nightly-repo-auditor').toolsets, template('nightly-repo-auditor').approval]).toEqual([['terminal', 'file', 'web', 'memory'], 'smart'])
    expect(template('deep-researcher').toolsets).not.toContain('terminal')
  })

  it('asks for a folder and a run time exactly when the template has a schedule', () => {
    for (const item of BOT_TEMPLATES) expect(asksOf(item), item.id).toEqual(item.schedule === null ? [] : ['repo-folder', 'run-time'])
    expect(template('nightly-repo-auditor').schedule).toEqual({ defaultTime: '02:00' })
    expect(BOT_TEMPLATES.filter(item => item.schedule !== null)).toHaveLength(1)
  })

  it('says each mode and toolset in plain words', () => {
    expect(toolWords(template('bot-builder').toolsets)).toBe('Terminal, Files, Ask you questions, Skills, To-do list')
    expect(toolWords(template('deep-researcher').toolsets)).toBe('Web, Browser, Helpers, Files, To-do list, Memory, Ask you questions')
    expect(APPROVAL_WORDS.manual).toEqual({ label: 'Manual', says: 'asks before every command' })
    expect(APPROVAL_WORDS.smart).toEqual({ label: 'Smart', says: 'asks only when a command looks risky' })
  })

  it('starts each personality with one sentence that says what the bot is', () => {
    expect(personaStart(template('bot-builder').persona)).toBe('You help people make new Hermes bots.')
    expect(personaStart('No end')).toBe('No end')
    for (const item of BOT_TEMPLATES) expect(personaStart(item.persona).length, item.id).toBeLessThan(80)
  })
})

describe('the nightly schedule', () => {
  it('reads a 24-hour time as a 12-hour one', () => {
    expect([timeWords('02:00'), timeWords('00:05'), timeWords('12:00'), timeWords('13:30'), timeWords('23:59')]).toEqual(['2:00 AM', '12:05 AM', '12:00 PM', '1:30 PM', '11:59 PM'])
    expect(scheduleWords('02:00')).toBe('Runs nightly at 2:00 AM')
  })

  it('leaves a time it cannot read as it was, such as the empty box', () => {
    expect([timeWords(''), timeWords('25:00'), timeWords('2:00')]).toEqual(['', '25:00', '2:00'])
  })
})
