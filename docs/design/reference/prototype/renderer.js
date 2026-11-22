// One reducer over gateway frames, three views over the same state.
const state = {
  variant: 'A',
  turns: [],
  live: { phase: 'idle' },
  open: new Set()
}

const VERB = {
  terminal: 'Running', process: 'Running', execute_code: 'Running',
  read_file: 'Reading', search_files: 'Searching', web_search: 'Searching', web_extract: 'Reading',
  write_file: 'Editing', patch: 'Editing', skill_manage: 'Editing',
  browser_navigate: 'Browsing', todo: 'Planning', memory: 'Remembering', clarify: 'Asking'
}
const verb = name => VERB[name] ?? 'Using'

const stripAnsi = s => String(s ?? '').replace(/\x1b\[[0-9;]*m/g, '')
const firstArg = args => args && (args.command ?? args.path ?? args.file_path ?? args.query ?? args.url ?? args.pattern)
const toolDetail = t => stripAnsi(firstArg(t.args) ?? t.preview ?? t.argsText ?? '')

function resultText(p) {
  const r = p.result
  if (r && typeof r === 'object' && 'output' in r) return `${r.output || '(no output)'}${r.exit_code ? `\nexit ${r.exit_code}` : ''}`
  if (typeof r === 'string') return r
  if (r !== undefined) return JSON.stringify(r, null, 2)
  return p.result_text ?? ''
}

function currentTurn() {
  let turn = state.turns.at(-1)
  if (!turn || turn.status) {
    turn = { user: null, items: [], status: null }
    state.turns.push(turn)
  }
  return turn
}

const tool = id => {
  for (const turn of state.turns) for (const it of turn.items) if (it.kind === 'tool' && it.id === id) return it
}

function reduce(frame) {
  if (frame.kind === 'local' && frame.type === 'user') {
    state.turns.push({ user: frame.text, items: [], status: null })
    state.live = { phase: 'thinking' }
    return
  }
  if (frame.kind === 'local' && frame.type === 'approval.answered') {
    for (const turn of state.turns) for (const it of turn.items) if (it.kind === 'approval' && it.requestId === frame.request_id) it.answered = frame.choice
    state.live = { phase: 'working', tool: state.live.tool, detail: state.live.detail }
    return
  }
  const isApproval = (frame.kind === 'request' && frame.method === 'approval') || (frame.kind === 'event' && frame.type === 'approval.request')
  if (isApproval) {
    const p = frame.params ?? frame.payload ?? {}
    currentTurn().items.push({
      kind: 'approval', rpcId: frame.kind === 'request' ? frame.id : null, requestId: p.prompt_id ?? p.request_id, generation: frame.execution_generation ?? p.execution_generation,
      command: p.command, description: p.description, choices: p.choices ?? ['once', 'session', 'always', 'deny'], answered: null
    })
    state.live = { phase: 'blocked', tool: p.tool_name ?? 'terminal', detail: p.command }
    return
  }
  if (frame.kind !== 'event') return
  const p = frame.payload ?? {}
  const turn = currentTurn()
  switch (frame.type) {
    case 'reasoning.delta':
    case 'thinking.delta':
      if (state.live.phase !== 'working') state.live = { phase: 'thinking' }
      break
    case 'message.delta': {
      if (!p.text) break
      const last = turn.items.at(-1)
      if (last?.kind === 'text') last.text += p.text
      else turn.items.push({ kind: 'text', text: p.text })
      state.live = { phase: 'streaming' }
      break
    }
    case 'tool.generating':
      state.live = { phase: 'working', tool: p.name, detail: 'preparing…' }
      break
    case 'tool.start': {
      const t = { kind: 'tool', id: p.tool_id, name: p.name, args: p.args, argsText: p.args_text, preview: p.preview, phase: 'running', started: Date.now() }
      turn.items.push(t)
      state.live = { phase: 'working', tool: p.name, detail: toolDetail(t) }
      break
    }
    case 'tool.progress':
      if (state.live.phase === 'working' && p.message) state.live.detail = p.message
      break
    case 'tool.complete': {
      const t = tool(p.tool_id) ?? (turn.items.push({ kind: 'tool', id: p.tool_id, name: p.name, args: p.args }), tool(p.tool_id))
      Object.assign(t, {
        phase: 'done', args: p.args ?? t.args, summary: p.summary, duration: p.duration_s,
        resultText: resultText(p),
        diff: p.inline_diff
      })
      state.live = { phase: 'thinking' }
      break
    }
    case 'message.complete': {
      const streamed = turn.items.some(it => it.kind === 'text')
      const text = typeof p.text === 'string' ? p.text : ''
      if (!streamed && text) turn.items.push({ kind: 'text', text })
      if (p.error) turn.items.push({ kind: 'error', text: p.error })
      turn.status = p.status ?? (p.error ? 'error' : 'complete')
      state.live = { phase: 'settled', outcome: turn.status, at: Date.now() }
      break
    }
    case 'approval.settled':
    case 'approval.cancelled':
      for (const it of turn.items) if (it.kind === 'approval' && it.requestId === (p.prompt_id ?? p.request_id) && !it.answered) it.answered = frame.type === 'approval.cancelled' ? 'cancelled' : 'settled'
      break
    case 'error':
      turn.items.push({ kind: 'error', text: p.message })
      break
  }
}

// ---------- rendering ----------
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

function md(src) {
  const parts = String(src).split(/```[\w-]*\n?/)
  return parts.map((chunk, i) => {
    if (i % 2) return `<pre><code>${esc(chunk.replace(/\n$/, ''))}</code></pre>`
    return chunk.split(/\n{2,}/).filter(b => b.trim()).map(b =>
      `<p>${esc(b).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>')}</p>`
    ).join('')
  }).join('')
}

function diffHtml(d) {
  const lines = stripAnsi(d).split('\n').filter(l => l.trim() && !l.trim().startsWith('┊') && !/ → /.test(l))
  const hunks = lines.filter(l => l.startsWith('@@'))
  const hideHunk = hunks.length === 1 && /^@@ -0,0 /.test(hunks[0])
  return lines.filter(l => !(hideHunk && l.startsWith('@@'))).map(l => {
    if (l.startsWith('@@')) return `<span class="ln hunk">${esc(l)}</span>`
    const mark = l[0] === '+' || l[0] === '-' ? l[0] : ' '
    const cls = mark === '+' ? 'add' : mark === '-' ? 'del' : 'ctx'
    return `<span class="ln ${cls}"><span class="mk">${mark === '-' ? '−' : mark}</span>${esc(mark === ' ' ? l.replace(/^ /, '') : l.slice(1))}</span>`
  }).join('')
}

const diffStat = d => {
  const lines = stripAnsi(d).split('\n')
  return { add: lines.filter(l => l.startsWith('+') && !l.startsWith('+++')).length, del: lines.filter(l => l.startsWith('-') && !l.startsWith('---')).length }
}

const clip = (s, n = 4000) => (s.length > n ? s.slice(0, n) + `\n… ${s.length - n} more chars` : s)

const STEP = {
  write_file: ['Wrote', 'Writing'], patch: ['Edited', 'Editing'], terminal: ['Ran', 'Running'], process: ['Ran', 'Running'],
  read_file: ['Read', 'Reading'], search_files: ['Searched', 'Searching']
}
const subject = t => {
  const raw = toolDetail(t)
  if (t.name === 'terminal' || t.name === 'process') return raw.replace(/^cd \S+ && /, '')
  return raw.split('/').pop() || raw
}
const createdFile = t => t.name === 'write_file' && /@@ -0,0 /.test(stripAnsi(t.diff ?? ''))
function stepTitle(t, live = t.phase === 'running') {
  const [done, doing] = createdFile(t) ? ['Created', 'Creating'] : STEP[t.name] ?? [`Used ${t.name}`, `Using ${t.name}`]
  const s = subject(t)
  return `${live ? doing : done}${s ? ` <code>${esc(s.length > 56 ? s.slice(0, 55) + '…' : s)}</code>` : ''}`
}

function toolRow(t, { live = false } = {}) {
  const open = state.open.has(t.id)
  const stat = t.diff ? diffStat(t.diff) : null
  const meta = t.phase === 'running' ? '' : [statHtml(stat), t.duration >= 1 ? `<span class="dur">${t.duration.toFixed(1)} s</span>` : ''].join('')
  const args = t.args ? JSON.stringify(t.args, null, 2) : t.argsText ?? ''
  const isCmd = t.name === 'terminal' || t.name === 'process'
  const sections = []
  if (t.diff) sections.push(['Changes', `<p class="path">${esc(toolDetail(t))}</p><pre class="diff">${diffHtml(t.diff)}</pre>`])
  if (t.resultText && (!t.diff || /error/i.test(t.resultText))) {
    const empty = isCmd && t.resultText.startsWith('(no output)')
    sections.push([isCmd ? 'Output' : 'Result', empty ? '<p class="empty">No output</p>' : `<pre>${esc(clip(stripAnsi(t.resultText)))}</pre>`])
  }
  if (args && !t.diff && !isCmd) sections.push(['Input', `<pre>${esc(clip(args, 1500))}</pre>`])
  const bare = sections.length === 1 && sections[0][1].startsWith('<p class="empty">')
  const record = sections.map(([h, body]) => `<section>${sections.length > 1 ? `<h4>${h}</h4>` : ''}${body}</section>`).join('')
  if (!sections.length) return `<div class="step ${t.phase} ${live ? 'live' : ''}"><div class="head"><span class="title">${stepTitle(t)}</span><span class="meta">${meta}</span></div></div>`
  return `<div class="step ${t.phase} ${open ? 'open' : ''} ${live ? 'live' : ''}" data-toggle="${esc(t.id)}">
    <button class="head" aria-expanded="${open}"><span class="title">${stepTitle(t)}</span><span class="chev" aria-hidden="true"></span><span class="meta">${meta}</span></button>
    <div class="record ${bare ? 'bare' : ''}">${record}</div></div>`
}

function statHtml(stat) {
  if (!stat || (!stat.add && !stat.del)) return ''
  return `<span class="stat">${stat.add ? `<span class="plus">+${stat.add}</span>` : ''}${stat.add && stat.del ? ' ' : ''}${stat.del ? `<span class="minus">−${stat.del}</span>` : ''}</span>`
}

function describe(tools) {
  const files = [...new Set(tools.filter(t => t.diff).map(subject))]
  const cmds = tools.filter(t => t.name === 'terminal' || t.name === 'process')
  const parts = []
  for (const f of files) {
    const steps = tools.filter(t => t.diff && subject(t) === f)
    const created = createdFile(steps[0])
    const verbText = created ? (steps.length > 1 ? 'Created and edited' : 'Created') : 'Edited'
    parts.push(`${parts.length ? verbText.toLowerCase() : verbText} <code>${esc(f)}</code>`)
  }
  if (cmds.length === 1) parts.push(`${parts.length ? 'ran' : 'Ran'} <code>${esc(subject(cmds[0]).slice(0, 48))}</code>`)
  else if (cmds.length) parts.push(`${parts.length ? 'ran' : 'Ran'} ${cmds.length} commands`)
  if (!parts.length) parts.push(`Used ${tools.length} tool${tools.length > 1 ? 's' : ''}`)
  return parts.join(' and ')
}

function groupRow(tools, key, running) {
  if (tools.length === 1) return toolRow(tools[0], { live: running })
  const open = state.open.has(key)
  const label = running ? stepTitle(tools.at(-1), true) : describe(tools)
  const total = tools.filter(t => t.diff).map(t => diffStat(t.diff)).reduce((a, b) => ({ add: a.add + b.add, del: a.del + b.del }), { add: 0, del: 0 })
  return `<div class="group ${open ? 'open' : ''} ${running ? 'live' : ''}" data-toggle="${esc(key)}">
    <button class="head" aria-expanded="${open}"><span class="title">${label}</span><span class="count">${tools.length} steps</span><span class="chev" aria-hidden="true"></span><span class="meta">${running || new Set(tools.filter(t => t.diff).map(subject)).size < 2 ? '' : statHtml(total)}</span></button>
    <div class="steps">${tools.map(t => toolRow(t)).join('')}</div></div>`
}

const CHOICE = { once: 'Run once', session: 'Allow in this chat', always: 'Always allow', deny: "Don't run" }
const ANSWERED = { once: 'You allowed this once.', session: 'You allowed this for the rest of the chat.', always: 'You always allow this command.', deny: 'You chose not to run this.', cancelled: 'Hermes withdrew this request.', settled: 'Answered.' }
function approvalCard(a) {
  if (a.answered) return `<div class="approval answered"><p>${esc(ANSWERED[a.answered] ?? 'Answered.')}</p>${state.variant === 'A' ? `<pre>${esc(a.command)}</pre>` : ''}</div>`
  return `<div class="approval live" role="group" aria-label="Approval needed">
    <h3>Run this command?</h3><pre>${esc(a.command)}</pre>
    ${a.description ? `<p class="why">Hermes flagged it as “${esc(a.description)}”.</p>` : ''}
    <div class="choices">${a.choices.map((c, i) => `<button class="${i === 0 ? 'primary' : ''} ${c === 'deny' ? 'deny' : ''}" data-approve="${esc(a.requestId)}" data-choice="${esc(c)}">${esc(CHOICE[c] ?? c)}</button>`).join('')}</div>
  </div>`
}

function tipHtml() {
  const l = state.live
  if (l.phase === 'idle') return ''
  if (l.phase === 'settled') {
    if (Date.now() - l.at > 6000 && !window.__freezeMark) return ''
    const label = { complete: 'Done', error: 'Failed', interrupted: 'Stopped' }[l.outcome] ?? l.outcome
    return `<div class="tip ${l.outcome}" role="status"><span class="glyph"></span>${l.outcome === 'complete' ? `<span class="sr">${label}</span>` : label}</div>`
  }
  const what = {
    thinking: 'Thinking', streaming: 'Writing',
    working: l.tool ? stepTitle({ name: l.tool, args: { command: l.detail, path: l.detail } }, true) : 'Working',
    blocked: 'Waiting for your OK'
  }[l.phase]
  return `<div class="tip ${l.phase}" role="status"><span class="glyph"></span><span>${what}</span></div>`
}

function assistantHtml(turn, ti, isLast) {
  const v = state.variant
  const out = []
  const running = !turn.status
  let pending = []
  let liveShown = false
  const flush = last => {
    if (!pending.length) return
    if (v === 'C') {
      const live = running && last && pending.at(-1).phase === 'running'
      liveShown ||= live
      out.push(groupRow(pending, `g${ti}-${out.length}`, live))
    }
    pending = []
  }
  turn.items.forEach(it => {
    if (it.kind === 'tool') {
      if (v === 'B') {
        const live = it.phase === 'running'
        liveShown ||= live
        out.push(toolRow(it, { live }))
      }
      if (v === 'C') pending.push(it)
      return
    }
    flush(false)
    if (it.kind === 'text') out.push(`<div class="prose">${md(it.text)}</div>`)
    if (it.kind === 'approval') { out.push(approvalCard(it)); liveShown ||= !it.answered }
    if (it.kind === 'error') out.push(`<p class="err">${esc(it.text)}</p>`)
  })
  flush(true)
  const last = turn.items.at(-1)
  if (running && last?.kind === 'text' && state.live.phase === 'streaming' && out.length) out[out.length - 1] = out.at(-1).replace(/<\/p><\/div>$/, '<span class="caret"></span></p></div>')
  if (isLast && !liveShown) out.push(tipHtml())
  return `<div class="thread">${out.join('')}</div>`
}

function render() {
  const scroller = document.getElementById('scroll')
  const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 60
  document.getElementById('transcript').innerHTML = state.turns.map((t, i) =>
    `<article class="turn">${t.user ? `<p class="request">${esc(t.user)}</p>` : ''}${assistantHtml(t, i, i === state.turns.length - 1)}</article>`).join('')
  document.querySelectorAll('.switch button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === state.variant)))
  if (atBottom) scroller.scrollTop = scroller.scrollHeight
}

// ---------- wiring ----------
window.gw.onFrame(frame => { reduce(frame); render() })
setInterval(() => state.live.phase === 'settled' && render(), 1000)

document.addEventListener('click', e => {
  const ap = e.target.closest('[data-approve]')
  if (ap) {
    const item = state.turns.flatMap(t => t.items).find(it => it.kind === 'approval' && it.requestId === ap.dataset.approve)
    window.gw.approve({ requestId: item.requestId, rpcId: item.rpcId, generation: item.generation, choice: ap.dataset.choice })
    return
  }
  const sw = e.target.closest('.switch button')
  if (sw) return proto.setVariant(sw.dataset.v)
  const tg = e.target.closest('.head')?.parentElement
  if (tg?.dataset.toggle) {
    state.open.has(tg.dataset.toggle) ? state.open.delete(tg.dataset.toggle) : state.open.add(tg.dataset.toggle)
    render()
  }
})
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'TEXTAREA') return
  const v = { 1: 'A', 2: 'B', 3: 'C' }[e.key]
  if (v) proto.setVariant(v)
})
document.getElementById('form').addEventListener('submit', e => {
  e.preventDefault()
  const input = document.getElementById('input')
  if (input.value.trim()) proto.submit(input.value.trim())
  input.value = ''
})

window.proto = {
  setVariant(v) { state.variant = v; render() },
  expandAll() {
    state.turns.forEach((t, ti) => t.items.forEach(it => it.kind === 'tool' && state.open.add(it.id)))
    document.querySelectorAll('.group').forEach(g => state.open.add(g.dataset.toggle))
    render()
  },
  submit(text) { return window.gw.submit(text) }
}
window.__freezeMark = false
render()
