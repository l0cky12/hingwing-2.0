import { BOT_TEMPLATES, type BotId } from '@highwing/hermes/domain'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TemplateDialog } from '../src/renderer/apps/Templates'

const dialog = (id: string, problemOf: (name: string) => string | null = () => null) =>
  renderToStaticMarkup(
    <TemplateDialog template={BOT_TEMPLATES.find(item => item.id === id)!} problemOf={problemOf} onCreate={async () => ({ ok: true, value: { bot: 'rae' as BotId, warnings: [] } })} onOpen={async () => {}} onClose={() => {}} />
  )
const createButton = (html: string) => /<button[^>]*>(?:Create bot|Creating…)<\/button>/.exec(html)?.[0]

describe("a template's setup dialog", () => {
  it("fills the bot's name with a name Hermes takes for a profile", () => {
    expect(dialog('deep-researcher')).toContain('value="deep-researcher"')
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

  it('can make a bot that needs only a name, from the first moment', () => {
    for (const id of ['bot-builder', 'deep-researcher']) expect(createButton(dialog(id)), id).not.toContain('disabled')
  })

  it('waits for the auditor\'s folder', () => {
    expect(createButton(dialog('nightly-repo-auditor'))).toContain('disabled=""')
  })

  it('says why a name Hermes would refuse cannot be used, and waits for another', () => {
    const html = dialog('bot-builder', name => `There's already a bot called ${name}.`)
    expect(html).toContain('There&#x27;s already a bot called bot-builder.')
    expect(html).toContain('aria-invalid="true"')
    expect(createButton(html)).toContain('disabled=""')
  })

  it('no longer says the making comes later', () => {
    for (const template of BOT_TEMPLATES) expect(dialog(template.id), template.id).not.toContain('next update')
  })
})
