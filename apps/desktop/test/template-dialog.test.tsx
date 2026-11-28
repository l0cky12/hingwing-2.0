import { BOT_TEMPLATES } from '@highwing/hermes/domain'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TemplateDialog } from '../src/renderer/apps/Templates'

const dialog = (id: string) => renderToStaticMarkup(<TemplateDialog template={BOT_TEMPLATES.find(item => item.id === id)!} onClose={() => {}} />)

describe("a template's setup dialog", () => {
  it("fills the bot's name with the template's name", () => {
    expect(dialog('deep-researcher')).toContain('value="Deep Researcher"')
  })

  it('asks only for a name when the template has no schedule', () => {
    for (const id of ['bot-builder', 'deep-researcher']) {
      const html = dialog(id)
      expect(html, id).not.toContain('Repository folder')
      expect(html, id).not.toContain('Run time')
      expect(html, id).not.toContain('Schedule')
    }
  })

  it('asks the auditor for a folder on the Hermes computer and a run time that starts at 2:00 AM', () => {
    const html = dialog('nightly-repo-auditor')
    expect(html).toContain('Repository folder')
    expect(html).toContain('aria-required="true"')
    expect(html).toContain('A folder path on the computer Hermes runs on')
    expect(html).toMatch(/type="time"[^>]*value="02:00"/)
    expect(html).toContain('Runs nightly at 2:00 AM')
  })

  it('summarizes what it sets up in words', () => {
    const html = dialog('bot-builder')
    expect(html).toContain('You help people make new Hermes bots.')
    expect(html).toContain('Terminal, Files, Ask you questions, Skills, To-do list')
    expect(html).toContain('Manual: asks before every command')
    expect(dialog('deep-researcher')).toContain('Smart: asks only when a command looks risky')
  })

  it('cannot make the bot yet, and says so', () => {
    for (const template of BOT_TEMPLATES) {
      const html = dialog(template.id)
      expect(html, template.id).toMatch(/<button[^>]*disabled=""[^>]*>Create bot<\/button>/)
      expect(html, template.id).toContain('Making the bot comes in the next update.')
    }
  })
})
