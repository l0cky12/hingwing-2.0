import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { contextMenu, recordingMenus, type MenuEntry, type MenuParams } from '../src/main/context-menu'

const FLAGS: Electron.EditFlags = { canUndo: true, canRedo: false, canCut: true, canCopy: true, canPaste: true, canDelete: true, canSelectAll: true, canEditRichly: false }
const CLICK: MenuParams = { misspelledWord: '', dictionarySuggestions: [], isEditable: false, selectionText: '', editFlags: FLAGS }
const TYPO: MenuParams = { ...CLICK, misspelledWord: 'teh', dictionarySuggestions: ['the', 'ten'], isEditable: true, selectionText: 'teh' }

const fakeTarget = () => ({ replaceMisspelling: vi.fn(), cut: vi.fn(), copy: vi.fn(), paste: vi.fn(), learn: vi.fn() })
const labels = (entries: readonly MenuEntry[]) => entries.flatMap(entry => (entry === 'separator' ? [] : [entry.label]))
const pick = (entries: readonly MenuEntry[], label: string) => {
  const entry = entries.find(entry => entry !== 'separator' && entry.label === label)
  if (entry === undefined || entry === 'separator') throw new Error(`no entry "${label}" in ${JSON.stringify(labels(entries))}`)
  entry.run()
}

describe('contextMenu', () => {
  it('offers the suggestions, then Add to dictionary, then Cut, Copy and Paste for a misspelled word', () => {
    const entries = contextMenu(TYPO, fakeTarget())
    expect(labels(entries)).toEqual(['the', 'ten', 'Add to dictionary', 'Cut', 'Copy', 'Paste'])
  })

  it('replaces the word with the suggestion picked', () => {
    const target = fakeTarget()
    pick(contextMenu(TYPO, target), 'the')
    expect(target.replaceMisspelling).toHaveBeenCalledWith('the')
  })

  it('adds the word itself to the dictionary', () => {
    const target = fakeTarget()
    pick(contextMenu(TYPO, target), 'Add to dictionary')
    expect(target.learn).toHaveBeenCalledWith('teh')
  })

  it('offers five suggestions at most', () => {
    const entries = contextMenu({ ...TYPO, dictionarySuggestions: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }, fakeTarget())
    expect(labels(entries).slice(0, 6)).toEqual(['a', 'b', 'c', 'd', 'e', 'Add to dictionary'])
  })

  it('offers only Add to dictionary for a word with no suggestions', () => {
    expect(labels(contextMenu({ ...TYPO, dictionarySuggestions: [] }, fakeTarget())).slice(0, 2)).toEqual(['Add to dictionary', 'Cut'])
  })

  it('disables what the field cannot do', () => {
    const entries = contextMenu({ ...CLICK, isEditable: true, editFlags: { ...FLAGS, canCut: false, canCopy: false } }, fakeTarget())
    expect(entries.flatMap(entry => (entry === 'separator' || entry.enabled !== false ? [] : [entry.label]))).toEqual(['Cut', 'Copy'])
  })

  it('shows no menu outside a field with nothing selected', () => {
    expect(contextMenu(CLICK, fakeTarget())).toEqual([])
  })

  it('offers only Copy for text selected outside a field', () => {
    const target = fakeTarget()
    const entries = contextMenu({ ...CLICK, selectionText: 'Done.' }, target)
    expect(labels(entries)).toEqual(['Copy'])
    pick(entries, 'Copy')
    expect(target.copy).toHaveBeenCalledOnce()
  })
})

describe('recordingMenus', () => {
  it('records each menu and runs the entry picked', () => {
    const log = join(mkdtempSync(join(tmpdir(), 'highwing-menus-')), 'menus.jsonl')
    const target = fakeTarget()
    const show = recordingMenus(log, 'the')
    show({} as Electron.BrowserWindow, contextMenu(TYPO, target))
    show({} as Electron.BrowserWindow, contextMenu({ ...CLICK, isEditable: true, editFlags: { ...FLAGS, canCopy: false } }, target))
    expect(readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line))).toEqual([
      { items: ['the', 'ten', 'separator', 'Add to dictionary', 'separator', 'Cut', 'Copy', 'Paste'] },
      { items: ['Cut', 'Copy', 'Paste'], disabled: ['Copy'] }
    ])
    expect(target.replaceMisspelling).toHaveBeenCalledExactlyOnceWith('the')
  })
})
