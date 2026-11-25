import { appendFileSync } from 'node:fs'

export type MenuEntry = { readonly label: string; readonly run: () => void; readonly enabled?: boolean; readonly accelerator?: string } | 'separator'

export type MenuParams = Pick<Electron.ContextMenuParams, 'misspelledWord' | 'dictionarySuggestions' | 'isEditable' | 'selectionText' | 'editFlags'>

export interface MenuTarget extends Pick<Electron.WebContents, 'replaceMisspelling' | 'cut' | 'copy' | 'paste'> {
  learn(word: string): void
}

export type ShowMenu = (window: Electron.BrowserWindow, entries: readonly MenuEntry[]) => void

const SUGGESTIONS_SHOWN = 5

export function contextMenu(params: MenuParams, target: MenuTarget): MenuEntry[] {
  const word = params.misspelledWord
  const spelling: MenuEntry[] = word === ''
    ? []
    : [
      ...params.dictionarySuggestions.slice(0, SUGGESTIONS_SHOWN).map(suggestion => ({ label: suggestion, run: () => target.replaceMisspelling(suggestion) })),
      ...(params.dictionarySuggestions.length > 0 ? ['separator' as const] : []),
      { label: 'Add to dictionary', run: () => target.learn(word) }
    ]
  const copy = { label: 'Copy', run: () => target.copy(), enabled: params.editFlags.canCopy, accelerator: 'CmdOrCtrl+C' }
  const editing: MenuEntry[] = params.isEditable
    ? [
      { label: 'Cut', run: () => target.cut(), enabled: params.editFlags.canCut, accelerator: 'CmdOrCtrl+X' },
      copy,
      { label: 'Paste', run: () => target.paste(), enabled: params.editFlags.canPaste, accelerator: 'CmdOrCtrl+V' }
    ]
    : params.selectionText === '' ? [] : [copy]
  return spelling.length > 0 && editing.length > 0 ? [...spelling, 'separator', ...editing] : [...spelling, ...editing]
}

export function attachContextMenu(window: Electron.BrowserWindow, show: ShowMenu): void {
  const contents = window.webContents
  const target: MenuTarget = {
    replaceMisspelling: word => contents.replaceMisspelling(word),
    cut: () => contents.cut(),
    copy: () => contents.copy(),
    paste: () => contents.paste(),
    learn: word => contents.session.addWordToSpellCheckerDictionary(word)
  }
  contents.on('context-menu', (_event, params) => {
    const entries = contextMenu(params, target)
    if (entries.length > 0) show(window, entries)
  })
}

export function desktopMenus(menu: Pick<typeof Electron.Menu, 'buildFromTemplate'>): ShowMenu {
  return (window, entries) => menu.buildFromTemplate(entries.map(entry => entry === 'separator'
    ? { type: 'separator' }
    : { label: entry.label, click: entry.run, enabled: entry.enabled ?? true, ...(entry.accelerator === undefined ? {} : { accelerator: entry.accelerator, registerAccelerator: false }) }
  )).popup({ window })
}

export function recordingMenus(logFile: string, pick: string | undefined): ShowMenu {
  return (_window, entries) => {
    const disabled = entries.flatMap(entry => (entry !== 'separator' && entry.enabled === false ? [entry.label] : []))
    appendFileSync(logFile, `${JSON.stringify({ items: entries.map(entry => (entry === 'separator' ? entry : entry.label)), ...(disabled.length > 0 ? { disabled } : {}) })}\n`)
    for (const entry of entries) if (entry !== 'separator' && entry.label === pick && entry.enabled !== false) return entry.run()
  }
}
