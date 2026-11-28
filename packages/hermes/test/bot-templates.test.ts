import { describe, expect, it } from 'vitest'
import { APPROVAL_MODES } from '../src/domain/session'
import { asksOf, auditPrompt, BOT_TEMPLATES, cronOf, isRunTime, personaStart, scheduleWords, TEMPLATE_TOOLSETS, templatePlan, timeWords, toolWords } from '../src/domain/bot-templates'

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

  it('says each toolset in plain words', () => {
    expect(toolWords(template('bot-builder').toolsets)).toBe('Terminal, Files, Ask you questions, Skills, To-do list')
    expect(toolWords(template('deep-researcher').toolsets)).toBe('Web, Browser, Helpers, Files, To-do list, Memory, Ask you questions')
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

describe('the audit prompt', () => {
  it('names the folder, fetches without pulling, and stays read-only', () => {
    const prompt = auditPrompt('/srv/app')
    expect(prompt).toContain('/srv/app')
    expect(prompt).toContain('`git fetch`')
    expect(prompt).toContain('Never pull')
    expect(prompt).toContain('Never edit files, commit or push.')
  })
})

describe('the cron line of a run time', () => {
  it('runs every day at that time, without leading zeros', () => {
    expect([cronOf('02:00'), cronOf('00:05'), cronOf('13:30'), cronOf('23:59'), cronOf('00:00')]).toEqual(['0 2 * * *', '5 0 * * *', '30 13 * * *', '59 23 * * *', '0 0 * * *'])
  })

  it('is null for text that is not HH:MM, as the empty box is', () => {
    expect(['', '25:00', '2:00', '02:60', '02:00 ', 'noon'].map(cronOf)).toEqual([null, null, null, null, null, null])
    expect(['02:00', '23:59', '', '24:00'].map(isRunTime)).toEqual([true, true, false, false])
  })
})

describe('the plan that makes a bot from a template', () => {
  const answers = { name: ' Ledger ', folder: ' /srv/billing ', time: '03:30' }

  it('creates the profile, then turns on the tools, then sets the approval mode', () => {
    const builder = template('bot-builder')
    expect(templatePlan(builder, answers)).toEqual([
      { step: 'create', name: 'Ledger', description: builder.summary, soul: builder.persona },
      { step: 'toolsets', toolsets: builder.toolsets },
      { step: 'approval', mode: 'manual' }
    ])
  })

  it('adds the nightly job last for a scheduled template, with the cron line and the audit prompt', () => {
    const auditor = template('nightly-repo-auditor')
    expect(templatePlan(auditor, answers)).toEqual([
      { step: 'create', name: 'Ledger', description: auditor.summary, soul: auditor.persona },
      { step: 'toolsets', toolsets: auditor.toolsets },
      { step: 'approval', mode: 'smart' },
      { step: 'job', name: 'Nightly audit', schedule: '30 3 * * *', prompt: auditPrompt('/srv/billing'), deliver: 'bot-chat' }
    ])
  })

  it('ignores the folder and the time for a template that has no schedule', () => {
    const blank = { name: 'Scout', folder: '', time: '' }
    for (const id of ['bot-builder', 'deep-researcher']) expect(templatePlan(template(id), blank)?.map(step => step.step), id).toEqual(['create', 'toolsets', 'approval'])
  })

  it('is null while an answer is missing', () => {
    const auditor = template('nightly-repo-auditor')
    expect(templatePlan(auditor, { ...answers, name: '  ' })).toBeNull()
    expect(templatePlan(auditor, { ...answers, folder: ' ' })).toBeNull()
    expect(templatePlan(auditor, { ...answers, time: '' })).toBeNull()
    expect(templatePlan(template('bot-builder'), { ...answers, name: '' })).toBeNull()
  })

  it("turns on only toolsets Hermes names, and every template's plan starts with its profile", () => {
    for (const item of BOT_TEMPLATES) {
      const plan = templatePlan(item, { name: 'x', folder: '/x', time: '02:00' })!
      expect(plan[0].step, item.id).toBe('create')
      for (const step of plan) if (step.step === 'toolsets') for (const toolset of step.toolsets) expect(TEMPLATE_TOOLSETS).toContain(toolset)
    }
  })
})
