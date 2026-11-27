import type { BotId, Target } from '@highwing/hermes/domain'
import { useEffect, useRef } from 'react'
import { NO_VISITS, stepped, visited } from '../chat-history'
import { MAC } from '../keys'
import { listOf, selectedIn } from '../bots/roster-view'
import { rowsIn, sidebarOf } from '../bots/sidebar-view'
import { botBeside, modalOpen, shortcutOf, type ShortcutId } from '../shortcuts'
import { run, useTopic } from '../store'

// Their own components listen for these, because only they know when the press has a meaning.
const HANDLED_ELSEWHERE: ReadonlySet<ShortcutId> = new Set(['palette', 'newChat', 'find', 'newGroup'])

const composerBox = () => {
  const box = document.querySelector<HTMLTextAreaElement>('footer.composer textarea')
  return box?.checkVisibility() === true ? box : null
}

function addSelectionToComposer() {
  const box = composerBox()
  if (box === null) return
  const selection = window.getSelection()
  const thread = document.getElementById('scroll')
  const text = selection !== null && !selection.isCollapsed && thread?.contains(selection.anchorNode) === true && thread.contains(selection.focusNode) ? selection.toString().trim() : ''
  box.focus()
  if (text === '') return
  box.setSelectionRange(box.value.length, box.value.length)
  const quote = `${text.split('\n').map(line => `> ${line}`).join('\n')}\n\n`
  // execCommand, not an assignment, so the box's own onChange runs and Undo takes the quote back out.
  document.execCommand('insertText', false, box.value === '' || box.value.endsWith('\n') ? quote : `\n${quote}`)
}

interface ShortcutsProps {
  readonly target: Target | null
  readonly settingsShown: boolean
  readonly onSheet: () => void
}

/** Every window shortcut that needs no component of its own, from one listener. */
export function Shortcuts({ target, settingsShown, onSheet }: ShortcutsProps) {
  const bots = useTopic('bots')
  const open = useTopic('open')
  const visits = useRef(NO_VISITS)
  const shown = open?.shown ?? null

  useEffect(() => {
    visits.current = visited(visits.current, shown)
  }, [shown])

  useEffect(() => {
    const selected = selectedIn(bots, open)
    const order = rowsIn(sidebarOf(listOf(bots, null), false, selected)).map(row => row.bot.id)
    const openBot = (bot: BotId | null) => { if (bot !== null) void run({ do: 'open', ref: { kind: 'bot', bot } }) }
    const walk = (by: -1 | 1) => {
      const before = visits.current
      const next = stepped(before, by)
      const ref = next?.refs[next.at]
      if (next === null || ref === undefined) return
      visits.current = next
      void run({ do: 'open', ref }).then(outcome => { if (!outcome.ok) visits.current = before })
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || modalOpen()) return
      const hit = shortcutOf(event, MAC)
      if (hit === null || HANDLED_ELSEWHERE.has(hit.id)) return
      event.preventDefault()
      switch (hit.id) {
        case 'bot': return openBot(order[(hit.digit ?? 0) - 1] ?? null)
        case 'previousBot': return openBot(botBeside(order, selected, -1, false))
        case 'nextBot': return openBot(botBeside(order, selected, 1, false))
        case 'cycleBot': return openBot(botBeside(order, selected, 1, true))
        case 'cycleBotBack': return openBot(botBeside(order, selected, -1, true))
        case 'back': return walk(-1)
        case 'forward': return walk(1)
        case 'focusComposer': return composerBox()?.focus()
        case 'addSelection': return addSelectionToComposer()
        case 'settings': return target !== null && !settingsShown && !event.repeat ? void run({ do: 'editTarget' }) : undefined
        case 'zoomIn': return window.highwing.zoom('in')
        case 'zoomOut': return window.highwing.zoom('out')
        case 'zoomReset': return window.highwing.zoom('reset')
        case 'sheet': return event.repeat ? undefined : onSheet()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [bots, open, target, settingsShown, onSheet])

  return null
}
