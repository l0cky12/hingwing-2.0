import { parseSshHost, type SshHost, type Tuning } from '@highwing/hermes/domain'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FolderChip } from '../src/renderer/composer/FolderChip'
import { ThinkingChoices } from '../src/renderer/composer/ThinkingPill'
import { folderFieldLabel, thinkingLabel, thinkingShown } from '../src/renderer/composer/tuning'

const UNREAD: Tuning = { reasoning: null, busy: null, effort: null, fast: null, yolo: null }
const tuning = (said: Partial<Tuning>): Tuning => ({ ...UNREAD, ...said })
const choices = (said: Partial<Tuning>) => renderToStaticMarkup(<ThinkingChoices tuning={tuning(said)} sending={false} onTune={() => {}} />)
const named = (markup: string, type: 'radio' | 'checkbox') => [...markup.matchAll(new RegExp(`<label[^>]*><input type="${type}"[^>]*/>([^<]*)</label>`, 'g'))].map(match => match[1])

describe('the Thinking pill', () => {
  it('names the effort Hermes said, and the model\'s own level as Default', () => {
    expect(thinkingLabel(tuning({ effort: 'high' }))).toBe('Effort: High')
    expect(thinkingLabel(tuning({ effort: 'xhigh' }))).toBe('Effort: Extra high')
    expect(thinkingLabel(tuning({ effort: 'none' }))).toBe('Effort: Off')
    expect(thinkingLabel(tuning({ effort: 'default' }))).toBe('Effort: Default')
  })

  it('reads Thinking when Hermes answered fast or reasoning but not the effort', () => {
    expect(thinkingLabel(tuning({ fast: false }))).toBe('Thinking')
  })

  it('is absent while Hermes answered none of effort, fast and reasoning, whatever YOLO and busy say', () => {
    expect(thinkingShown(tuning({ yolo: true, busy: 'steer' }))).toBe(false)
    expect(thinkingShown(tuning({ reasoning: false }))).toBe(true)
  })

  it('offers Default and every level Hermes takes, with the said level checked', () => {
    const markup = choices({ effort: 'high', fast: false, reasoning: true })
    expect(named(markup, 'radio')).toEqual(['Default', 'Off', 'Minimal', 'Low', 'Medium', 'High', 'Extra high', 'Max', 'Ultra'])
    expect(markup).toMatch(/<input type="radio"[^>]*checked=""[^>]*\/>High</)
    expect(named(markup, 'checkbox')).toEqual(['Fast', 'Show reasoning'])
    expect(markup).toMatch(/role="switch" checked=""[^>]*\/>Show reasoning/)
  })

  it('leaves out each control whose switch Hermes did not answer', () => {
    expect(named(choices({ effort: 'default' }), 'checkbox')).toEqual([])
    const fastOnly = choices({ fast: true })
    expect(fastOnly).not.toContain('radiogroup')
    expect(named(fastOnly, 'checkbox')).toEqual(['Fast'])
  })
})

describe('the folder chip', () => {
  it('shows the folder exactly as Hermes names it', () => {
    const markup = renderToStaticMarkup(<FolderChip cwd="/home/ada/work" field="" disabled={false} running={false} onMove={() => new Promise(() => {})} />)
    expect(markup.replace(/<[^>]*>/g, '')).toBe('Folder: /home/ada/work')
  })

  it('names the machine the folder is on, or the Hermes machine when it has no name', () => {
    expect(folderFieldLabel({ kind: 'remote', host: parseSshHost('hermes-host.example-tailnet.ts.net') as SshHost })).toBe('Folder on hermes-host')
    expect(folderFieldLabel({ kind: 'local' })).toBe('Folder on this computer')
    expect(folderFieldLabel(null)).toBe('Folder on the Hermes machine')
  })
})
