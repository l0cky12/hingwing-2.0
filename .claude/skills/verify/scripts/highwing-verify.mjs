#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync, appendFileSync, openSync, readSync, closeSync } from 'node:fs'
import { delimiter, dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const DESKTOP = join(REPO, 'apps/desktop')
const MAIN_JS = join(DESKTOP, 'out/main/index.js')
const BROWSER_JS = join(dirname(fileURLToPath(import.meta.url)), 'sign-in-browser.mjs')
const EVIDENCE_ROOT = '/tmp/highwing-verify'
const SCRATCH_ROOT = '/tmp/highwing-verify-scratch'
const REFERENCE = join(REPO, 'docs/design/reference')
const SIZE = { width: 1180, height: 860 }
const QUIT_MS = 5_000
const VIDEO_HOLD_MS = 700
const requireDesktop = createRequire(join(DESKTOP, 'package.json'))

const FAKE_HOST = 'hermes-host.example-tailnet.ts.net'
/** The dev server a fixture names. `--serve` puts its own origin in its place. */
const DEV_ORIGIN = 'http://localhost:5173'
const ERRAND = join(REPO, 'fixtures/errand.jsonl')
const SETTINGS_FILE = 'connection.json'
const SIGN_INS_FILE = 'sign-ins.json'
const KEYRINGS = ['test', 'system']
const USER_FILES = ['HIGHWING_VERIFY_USER_FILE', 'HIGHWING_VERIFY_PASSWORD_FILE']
const MODE_FILE = 'mode.json'
const MODES = ['bots', 'chats']

const SAVED = {
  none: () => null,
  local: () => JSON.stringify({ version: 1, target: { kind: 'local' } }),
  remote: () => JSON.stringify({ version: 1, target: { kind: 'remote', host: FAKE_HOST } }),
  url: url => JSON.stringify({ version: 1, target: { kind: 'url', url } }),
  unreadable: () => '{"version": 1, "target"',
  newer: () => JSON.stringify({ version: 2, target: { kind: 'relay' } })
}
const SAVED_WITH = { host: ['none', 'local', 'remote', 'unreadable', 'newer'], webapp: ['none', 'url', 'unreadable', 'newer'] }
const STAND_IN_HOST = 'hermes.example.com'

const STATES = {
  window: page => page.locator('#root > :not([hidden])').first(),
  setup: page => page.getByRole('button', { name: 'Connect', exact: true, disabled: false }),
  'setup-checking': page => page.getByRole('status', { name: 'Checking' }),
  'setup-failed': page => page.getByRole('alert'),
  'setup-saved': page => page.getByRole('button', { name: 'Open chat', exact: true }),
  settings: page => page.getByRole('heading', { name: 'Settings', exact: true, level: 2 }),
  live: page => page.getByRole('button', { name: 'Send', exact: true, disabled: false }),
  'tool-running': page => page.locator('.step[data-end="live"]').filter({ hasText: /^Running / }),
  approval: page => page.getByRole('group', { name: 'Run this command?' }).getByRole('button', { name: 'Run once', exact: true, disabled: false }),
  settled: page => page.locator('[data-end="done"]'),
  drawn: page => page.locator('.prose:has(.diagram):not(:has(.diagram[data-state="drawing"]))').last(),
  offline: page => page.getByRole('status', { name: 'Connection' }),
  regenerate: page => page.getByRole('button', { name: 'Regenerate', exact: true, disabled: false }),
  'slash-menu': page => page.getByRole('listbox', { name: 'Commands and skills' }),
  mentions: page => page.getByRole('listbox', { name: 'Mentions' }),
  'relay-waiting': page => page.locator('.turn.relay [role="status"]'),
  bots: page => page.locator('aside[data-state="listed"], .bot-pick[data-state="listed"]'),
  unstarted: page => page.locator('main#scroll:empty'),
  'helper-running': page => page.locator('.helper[data-end="live"]').filter({ has: page.locator('> .head > .sr', { hasText: /^working$/ }) }),
  preview: page => page.getByRole('region', { name: 'Preview', exact: true }),
  'group-thinking': page => page.locator('#transcript .tip.thinking').filter({ hasText: / (?:is|are) thinking$/ }),
  'group-replied': page => page.locator('#transcript:has(.said-by):not(:has(.tip))')
}

const rendered = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))

const nth = (ctx, role, name, n) => ctx.page.getByRole(role, { name, exact: true }).nth(Number(n) - 1)

/** Runs in the page, so it carries its own helpers. */
function sampleCode({ lang, ms }) {
  const sample = () => {
    const blocks = Array.from(document.querySelectorAll('#scroll .code')).filter(block => lang === null || block.querySelector('.lang')?.textContent === lang)
    const block = blocks.at(-1)
    if (block === undefined) return null
    const colors = new Set()
    const walker = document.createTreeWalker(block.querySelector('pre code'), NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) if (node.data.trim() !== '') colors.add(getComputedStyle(node.parentElement).color)
    return { block, seen: { colors: [...colors], open: block.hasAttribute('data-open'), height: block.getBoundingClientRect().height, scroll: document.querySelector('#scroll').scrollHeight } }
  }
  if (ms === undefined) return sample()?.seen ?? null
  return new Promise(resolve => {
    let samples = []
    let watched = null
    const finish = () => {
      observer.disconnect()
      clearTimeout(timer)
      resolve(samples)
    }
    const take = () => {
      const now = sample()
      if (now === null) return
      if (now.block !== watched) [watched, samples] = [now.block, []]
      samples.push(now.seen)
      if (now.seen.colors.length > 1) finish()
    }
    const observer = new MutationObserver(take)
    const timer = setTimeout(finish, ms)
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true })
    take()
  })
}

const STEPS = {
  wait: { arity: 1, run: async (ctx, state) => waitFor(ctx, state) },
  see: { arity: 1, run: async (ctx, text) => ctx.page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout: ctx.timeout }) },
  said: { arity: 1, run: async (ctx, text) => ctx.page.locator('#scroll').getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout: ctx.timeout }) },
  click: { arity: 2, run: async (ctx, role, name) => byRole(ctx.page, role, name).click({ timeout: ctx.timeout }) },
  'click-at': { arity: 3, run: async (ctx, role, name, n) => nth(ctx, role, name, n).click({ timeout: ctx.timeout }) },
  'right-click': { arity: 2, run: async (ctx, role, name) => byRole(ctx.page, role, name).click({ button: 'right', timeout: ctx.timeout }) },
  'select-words': { arity: 1, run: async (ctx, text) => ctx.page.locator('#scroll').getByText(text, { exact: false }).first().click({ clickCount: 3, timeout: ctx.timeout }) },
  wheel: {
    arity: 3,
    run: async (ctx, role, name, dy) => {
      await byRole(ctx.page, role, name).hover({ timeout: ctx.timeout })
      await ctx.page.mouse.wheel(0, Number(dy))
    }
  },
  'right-click-words': { arity: 1, run: async (ctx, text) => ctx.page.locator('#scroll').getByText(text, { exact: false }).first().click({ button: 'right', timeout: ctx.timeout }) },
  type: {
    arity: 2,
    logs: true,
    run: async (ctx, label, text) => {
      const field = await secretField(ctx, 'type', label, text)
      await field.fill(expand(ctx, text), { timeout: ctx.timeout })
    }
  },
  select: { arity: 2, run: async (ctx, label, option) => void (await ctx.page.getByLabel(label, { exact: true }).selectOption({ label: option }, { timeout: ctx.timeout })) },
  press: { arity: 1, run: async (ctx, key) => ctx.page.keyboard.press(key) },
  reload: { arity: 0, run: async ctx => void await ctx.page.reload() },
  gone: { arity: 2, run: async (ctx, role, name) => waitGone(ctx, role, name) },
  inview: { arity: 2, run: async (ctx, role, name) => checkInView(ctx, role, name) },
  reveal: { arity: 2, run: async (ctx, role, name) => byRole(ctx.page, role, name).scrollIntoViewIfNeeded({ timeout: ctx.timeout }) },
  shot: { arity: 1, run: async (ctx, name) => shoot(ctx, name) },
  field: {
    arity: 3,
    run: async (ctx, label, lines, outcome) => {
      if (outcome !== 'fits' && outcome !== 'scrolls') throw new Error(`field outcome must be "fits" or "scrolls", not "${outcome}"`)
      const m = await ctx.page.getByLabel(label, { exact: true }).evaluate(el => {
        const style = getComputedStyle(el)
        return {
          client: el.clientHeight,
          content: el.scrollHeight,
          lineHeight: parseFloat(style.lineHeight),
          padding: parseFloat(style.paddingTop) + parseFloat(style.paddingBottom),
          scrollbar: el.offsetWidth - el.clientWidth - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth)
        }
      }, undefined, { timeout: ctx.timeout })
      const shown = Math.round((m.client - m.padding) / m.lineHeight)
      const scrolls = m.content > m.client + 1 && m.scrollbar > 2
      log(ctx, `  "${label}" shows ${shown} lines in ${m.client}px (content ${m.content}px, scrollbar ${m.scrollbar}px), ${scrolls ? 'scrolls' : 'fits'}`)
      if (shown !== Number(lines)) throw new Error(`"${label}" shows ${shown} lines, not ${lines}`)
      if (scrolls !== (outcome === 'scrolls')) throw new Error(`"${label}" ${scrolls ? 'scrolls' : 'fits'}, not ${outcome}`)
    }
  },
  pinned: {
    arity: 0,
    run: async ctx => {
      const m = await ctx.page.evaluate(() => {
        const scroller = document.querySelector('#scroll')
        const footer = document.querySelector('footer')
        if (!scroller || !footer) return null
        const rows = scroller.querySelectorAll('.request, .thread > *, .turn.pending > *, .relay-reply > *')
        const last = rows[rows.length - 1] ?? scroller
        const view = scroller.getBoundingClientRect()
        const row = last.getBoundingClientRect()
        return {
          fromEnd: scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight,
          rowTop: row.top,
          rowBottom: row.bottom,
          viewTop: view.top,
          viewBottom: view.bottom,
          footerTop: footer.getBoundingClientRect().top
        }
      })
      if (m === null) throw new Error('no #scroll or footer on the page')
      log(ctx, `  thread ${m.fromEnd.toFixed(1)}px from its end, last row ${m.rowTop.toFixed(1)}-${m.rowBottom.toFixed(1)} in view ${m.viewTop.toFixed(1)}-${m.viewBottom.toFixed(1)}, footer top ${m.footerTop.toFixed(1)}`)
      if (m.fromEnd > 1) throw new Error(`thread is ${m.fromEnd.toFixed(1)}px short of its end`)
      const fitsInView = m.rowBottom - m.rowTop <= m.viewBottom - m.viewTop
      if (m.rowBottom > m.viewBottom + 0.5 || m.rowBottom < m.viewTop || (fitsInView && m.rowTop < m.viewTop - 0.5)) throw new Error('the last row of the thread is not in view')
      if (m.viewBottom > m.footerTop + 0.5) throw new Error('the composer covers the thread')
    }
  },
  'disabled-at': {
    arity: 3,
    run: async (ctx, role, name, n) => {
      if (!(await nth(ctx, role, name, n).isDisabled({ timeout: ctx.timeout }))) throw new Error(`${role} "${name}" number ${n} is enabled`)
    }
  },
  disabled: {
    arity: 2,
    run: async (ctx, role, name) => {
      if (!(await byRole(ctx.page, role, name).isDisabled({ timeout: ctx.timeout }))) throw new Error(`${role} "${name}" is enabled`)
    }
  },
  opened: {
    arity: 2,
    run: async (ctx, action, target) => {
      const call = action === 'browse' ? { action, url: served(ctx, target) } : { action, path: target }
      const calls = await pollUntil(ctx, () => opensRecorded(ctx), recorded => recorded.length > 0).catch(() => [])
      if (calls.length !== 1 || JSON.stringify(calls[0]) !== JSON.stringify(call)) {
        throw new Error(`expected exactly one open call ${JSON.stringify(call)}, recorded ${JSON.stringify(calls)}`)
      }
    }
  },
  'nothing-opened': {
    arity: 0,
    run: async ctx => {
      const calls = opensRecorded(ctx)
      if (calls.length > 0) throw new Error(`main opened ${calls.length} thing(s) on the desktop: ${JSON.stringify(calls)}`)
    }
  },
  previewing: {
    arity: 1,
    run: async (ctx, url) => {
      const wanted = isPattern(url) ? nameMatcher(url) : served(ctx, url)
      const matches = state => state !== null && !state.loading && (typeof wanted === 'string' ? state.url === wanted : wanted.test(state.url))
      const state = await poll(ctx, () => inPreview(ctx, 'state'), matches)
      if (!matches(state)) throw new Error(`the preview is ${state === null ? 'not open' : `on ${state.url}${state.loading ? ', still loading' : ''}`}, not on ${url}`)
      log(ctx, `  the preview shows ${state.url} at ${JSON.stringify(state.bounds)}, ${state.visible ? 'visible' : 'hidden'}`)
    }
  },
  'page-says': {
    arity: 1,
    run: async (ctx, text) => {
      const said = await poll(ctx, () => inPreview(ctx, 'text'), held => held?.includes(text) === true)
      if (said?.includes(text) !== true) throw new Error(`the previewed page does not say ${JSON.stringify(text)}: ${JSON.stringify(said?.slice(0, 200) ?? 'no page')}`)
    }
  },
  blur: {
    arity: 0,
    run: async ctx => {
      const focused = await ctx.app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.blur()
        return BrowserWindow.getFocusedWindow() !== null
      })
      if (focused) throw new Error('a Highwing window still has focus after blur')
    }
  },
  notified: {
    arity: 2,
    run: async (ctx, title, n) => {
      const titled = () => noticesRecorded(ctx).filter(notice => notice.title === title)
      const held = await poll(ctx, async () => titled(), notices => notices.length >= Number(n))
      for (const notice of held) log(ctx, `  ${JSON.stringify(notice)}`)
      if (held.length !== Number(n)) throw new Error(`main recorded ${held.length} notification(s) titled "${title}", not ${n}`)
      ctx.notified.push({ title, n: Number(n) })
    }
  },
  menu: { arity: 2, run: async (ctx, key, label) => pressForMenu(ctx, key, label, true) },
  'menu-without': { arity: 2, run: async (ctx, key, label) => pressForMenu(ctx, key, label, false) },
  relaunch: {
    arity: 0,
    run: async ctx => {
      await quitApp(ctx)
      await launchApp(ctx)
      log(ctx, `  relaunched as pid ${ctx.pid}, with the user-data directory and the gateway of the first launch`)
    }
  },
  webapp: {
    arity: 1,
    run: async (ctx, command) => {
      if (!ctx.web?.tell) throw new Error('"webapp" needs --fake-webapp, because only the fake Hermes takes orders')
      if (command !== 'sign-out') throw new Error(`unknown webapp command "${command}". Known: sign-out`)
      ctx.web.tell(command)
    }
  },
  browsed: {
    arity: 1,
    run: async (ctx, n) => {
      const pages = await pollUntil(ctx, () => signInPages(ctx), opened => opened.length >= Number(n)).catch(() => signInPages(ctx))
      if (pages.length !== Number(n)) throw new Error(`main opened the gateway's sign-in page ${pages.length} time(s), not ${n}`)
      ctx.browsed = Number(n)
    }
  },
  'native-menus': {
    arity: 1,
    run: async (ctx, n) => {
      const deadline = Date.now() + MENU_SETTLE_MS
      while (Date.now() < deadline && menusRecorded(ctx).length < Number(n)) await new Promise(resolve => setTimeout(resolve, 50))
      await new Promise(resolve => setTimeout(resolve, MENU_SETTLE_MS))
      const menus = menusRecorded(ctx)
      for (const menu of menus) log(ctx, `  ${JSON.stringify(menu)}`)
      if (menus.length !== Number(n)) throw new Error(`main recorded ${menus.length} native menu(s), not ${n}`)
    }
  },
  second: {
    arity: 1,
    run: async (ctx, arg) => {
      const child = spawn(ctx.launch.executable, [...ctx.launch.args, arg], { cwd: ctx.launch.cwd, env: ctx.launch.env, stdio: 'ignore' })
      writeFileSync(ctx.launch.secondPid, String(child.pid))
      const code = await new Promise(done => {
        const timer = setTimeout(() => done(null), ctx.timeout)
        child.on('exit', (exitCode, signal) => {
          clearTimeout(timer)
          done(exitCode ?? signal)
        })
      })
      if (code === null) child.kill('SIGKILL')
      rmSync(ctx.launch.secondPid, { force: true })
      log(ctx, `  second instance pid ${child.pid} ${code === null ? `still running after ${ctx.timeout} ms, killed` : `exited with ${code}`}`)
      if (code === null) throw new Error(`the second instance did not exit within ${ctx.timeout} ms`)
    }
  },
  home: {
    arity: 0,
    run: async ctx => {
      const windows = await ctx.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => window.webContents.getURL()))
      if (windows.length !== 1 || windows[0] !== ctx.home) throw new Error(`the app's windows are at ${JSON.stringify(windows)}, not only at ${ctx.home}`)
    }
  },
  copied: {
    arity: 1,
    run: async (ctx, text) => {
      const held = await pollUntil(ctx, () => ctx.app.evaluate(({ clipboard }) => clipboard.readText()), value => value === text).catch(() => null)
      if (held !== text) throw new Error(`clipboard holds ${JSON.stringify(held ?? 'something else')}, not ${JSON.stringify(text)}`)
    }
  },
  value: {
    arity: 2,
    logs: true,
    run: async (ctx, label, text) => {
      const field = await secretField(ctx, 'value', label, text)
      await rendered(ctx.page)
      const held = await field.inputValue({ timeout: ctx.timeout })
      if (held === text) return
      throw new Error(ctx.secretLabels.has(label) ? `"${label}" does not hold the expected value` : `"${label}" holds ${JSON.stringify(held)}, not ${JSON.stringify(text)}`)
    }
  },
  focused: {
    arity: 2,
    run: async (ctx, role, name) => {
      const found = matching(ctx.page, role, name)
      if (!(await found.evaluateAll(nodes => nodes.includes(document.activeElement)))) {
        const now = await ctx.page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent ?? 'nothing')
        throw new Error(`${role} "${name}" does not have focus; "${now}" does`)
      }
    }
  },
  count: {
    arity: 3,
    run: async (ctx, role, name, n) => {
      const found = await matching(ctx.page, role, name).count()
      if (found !== Number(n)) throw new Error(`${found} ${role}(s) named ${name}, not ${n}`)
    }
  },
  clipboard: {
    arity: 1,
    run: async (ctx, name) => {
      const read = () => ctx.app.evaluate(({ clipboard }) => clipboard.readText())
      const deadline = Date.now() + ctx.timeout
      let text = await read()
      while (text === '' || text === ctx.clipboard) {
        if (Date.now() > deadline) throw new Error(text === '' ? 'the clipboard is empty' : 'the clipboard has not changed since the last clipboard step')
        text = await read()
      }
      ctx.clipboard = text
      writeFileSync(join(ctx.evidence, `${name}.clip.txt`), text)
      log(ctx, `  saved ${name}.clip.txt (${text.length} characters)`)
    }
  },
  marks: {
    arity: 1,
    run: async (ctx, count) => {
      const found = await ctx.page.evaluate(() => ['find', 'find-current'].reduce((total, name) => total + [...(CSS.highlights.get(name) ?? [])].filter(range => !range.collapsed).length, 0))
      if (found !== Number(count)) throw new Error(`${found} ranges are marked, expected ${count}`)
    }
  },
  marked: {
    arity: 1,
    run: async (ctx, text) => {
      const held = await ctx.page.evaluate(() => [...(CSS.highlights.get('find-current') ?? [])][0]?.toString() ?? null)
      if (held !== text) throw new Error(`the current match covers ${JSON.stringify(held)}, not ${JSON.stringify(text)}`)
    }
  },
  hues: {
    arity: 1,
    run: async (ctx, n) => {
      const seen = await poll(ctx, () => ctx.page.evaluate(sampleCode, { lang: null }), held => held?.colors.length === Number(n))
      if (seen === null) throw new Error('the thread shows no code block')
      log(ctx, `  the last code block draws its text in ${seen.colors.length} color(s): ${seen.colors.join(', ')}`)
      if (seen.colors.length !== Number(n)) throw new Error(`the last code block draws its text in ${seen.colors.length} color(s), not ${n}`)
    }
  },
  fonts: {
    arity: 1,
    run: async (ctx, family) => {
      const faces = () => ctx.page.evaluate(name => [...document.fonts].filter(face => face.family.replace(/"/g, '') === name).map(face => `${face.style} ${face.weight} ${face.status}`), family)
      const settled = held => held.some(face => face.endsWith(' loaded')) && !held.some(face => face.endsWith(' loading'))
      const seen = await poll(ctx, faces, settled)
      log(ctx, `  ${family}: ${seen.join(', ') || 'no faces'}`)
      if (seen.some(face => face.endsWith(' error'))) throw new Error(`a ${family} face failed to load`)
      if (!settled(seen)) throw new Error(`no ${family} face finished loading within ${ctx.timeout} ms`)
    }
  },
  steady: {
    arity: 1,
    run: async (ctx, lang) => {
      const samples = await ctx.page.evaluate(sampleCode, { lang, ms: ctx.timeout })
      const colored = samples.at(-1)
      log(ctx, `  sampled the last "${lang}" block ${samples.length} time(s)`)
      if (colored === undefined || colored.colors.length < 2) throw new Error(`the last "${lang}" block showed no second color within ${ctx.timeout} ms`)
      if (samples.some(sample => sample.open && sample.colors.length > 1)) throw new Error(`the "${lang}" block showed colors while its fence was open`)
      const plain = samples.findLast(sample => !sample.open && sample.colors.length === 1)
      if (plain === undefined) throw new Error(`the "${lang}" block was never plain with its fence closed before its colors arrived`)
      log(ctx, `  closed and plain: block ${plain.height}px, thread ${plain.scroll}px. Colored: block ${colored.height}px, thread ${colored.scroll}px`)
      if (plain.height !== colored.height || plain.scroll !== colored.scroll) throw new Error(`the layout moved when the "${lang}" block's colors arrived`)
    }
  },
  enabled: {
    arity: 2,
    run: async (ctx, role, name) => {
      if (!(await byRole(ctx.page, role, name).isEnabled({ timeout: ctx.timeout }))) throw new Error(`${role} "${name}" is disabled`)
    }
  },
  checked: {
    arity: 2,
    run: async (ctx, role, name) => {
      if (!(await byRole(ctx.page, role, name).isChecked({ timeout: ctx.timeout }))) throw new Error(`${role} "${name}" is not checked`)
    }
  },
  current: {
    arity: 2,
    run: async (ctx, role, name) => {
      const locator = byRole(ctx.page, role, name)
      const value = await poll(ctx, () => locator.getAttribute('aria-current', { timeout: ctx.timeout }), held => held === 'true')
      if (value !== 'true') throw new Error(`${role} "${name}" is not the current one`)
    }
  },
  tally: {
    arity: 2,
    run: async (ctx, role, n) => {
      await rendered(ctx.page)
      const locator = ctx.page.getByRole(role)
      const seen = await poll(ctx, () => locator.count(), held => held === Number(n))
      if (seen !== Number(n)) throw new Error(`${seen} ${role} element(s) are shown, not ${n}`)
    }
  },
  absent: {
    arity: 1,
    run: async (ctx, text) => {
      const shown = await ctx.page.getByText(text, { exact: false }).filter({ visible: true }).count()
      if (shown > 0) throw new Error(`"${text}" is shown ${shown} time(s)`)
    }
  },
  called: {
    arity: 3,
    run: async (ctx, method, json, n) => {
      const check = { method, expected: JSON.parse(json), n: Number(n) }
      const seen = await poll(ctx, async () => callsLike(ctx, check), held => held >= check.n)
      if (seen !== check.n) throw new Error(`the gateway saw ${seen} ${method} call(s) containing ${json}, not ${n}`)
      ctx.called.push(check)
    }
  },
  reached: {
    arity: 3,
    run: async (ctx, method, json, n) => {
      const check = { method, expected: JSON.parse(json), n: Number(n) }
      const seen = await poll(ctx, async () => callsLike(ctx, check), held => held >= check.n)
      if (seen < check.n) throw new Error(`the gateway saw ${seen} ${method} call(s) containing ${json}, fewer than ${n}`)
    }
  },
  pressed: {
    arity: 3,
    run: async (ctx, role, name, value) => {
      if (value !== 'true' && value !== 'false') throw new Error(`pressed takes "true" or "false", not "${value}"`)
      const locator = byRole(ctx.page, role, name)
      const held = await poll(ctx, () => locator.getAttribute('aria-pressed', { timeout: ctx.timeout }), found => found === value)
      if (held !== value) throw new Error(`${role} "${name}" has aria-pressed ${JSON.stringify(held)}, not ${value}`)
    }
  },
  avatar: {
    arity: 2,
    run: async (ctx, name, drawn) => {
      if (drawn !== 'picture' && drawn !== 'letter') throw new Error(`avatar takes "picture" or "letter", not "${drawn}"`)
      const row = byRole(ctx.page, 'button', name)
      const read = () => row.evaluate(button => {
        const image = button.querySelector('img.avatar')
        if (image !== null) return image.complete && image.naturalWidth > 0 ? 'picture' : 'broken picture'
        return button.querySelector('span.avatar')?.textContent ? 'letter' : 'nothing'
      }, undefined, { timeout: ctx.timeout })
      const held = await poll(ctx, read, found => found === drawn)
      log(ctx, `  the avatar of "${name}" draws ${held}`)
      if (held !== drawn) throw new Error(`the avatar of "${name}" draws ${held}, not a ${drawn}`)
    }
  },
  'paste-image': {
    arity: 1,
    run: async (ctx, path) => {
      const bytes = readFileSync(resolve(process.cwd(), path)).toString('base64')
      await ctx.app.evaluate(({ clipboard, ClipboardItem }, png) =>
        clipboard.write([new ClipboardItem({ 'image/png': new Blob([Buffer.from(png, 'base64')], { type: 'image/png' }) })]), bytes)
      await ctx.page.getByLabel('Message Hermes', { exact: true }).focus({ timeout: ctx.timeout })
      await ctx.page.keyboard.press('Control+V')
    }
  },
  'drag-file': {
    arity: 1,
    run: async (ctx, name) => {
      ctx.dragged = await ctx.page.evaluateHandle(fileName => {
        const transfer = new DataTransfer()
        transfer.items.add(new File([new Uint8Array([1, 2, 3])], fileName))
        return transfer
      }, name)
      const thread = ctx.page.locator('#scroll')
      for (const type of ['dragenter', 'dragover']) await thread.dispatchEvent(type, { dataTransfer: ctx.dragged }, { timeout: ctx.timeout })
    }
  },
  'drop-file': {
    arity: 0,
    run: async ctx => {
      if (!ctx.dragged) throw new Error('drop-file needs a drag-file step before it')
      await ctx.page.locator('#scroll').dispatchEvent('drop', { dataTransfer: ctx.dragged }, { timeout: ctx.timeout })
      ctx.dragged = null
    }
  },
  drafts: {
    arity: 1,
    run: async (ctx, n) => {
      const held = await poll(ctx, async () => draftsOnDisk(ctx), files => files.length === Number(n))
      for (const { name, body } of held) log(ctx, `  ${name}: ${body}`)
      if (held.length !== Number(n)) throw new Error(`the drafts folder holds ${held.length} draft file(s), not ${n}`)
    }
  },
  answered: {
    arity: 3,
    run: async (ctx, method, json, n) => {
      const check = { method, expected: JSON.parse(json), n: Number(n) }
      const seen = await poll(ctx, async () => answersLike(ctx, check), held => held >= check.n)
      if (seen !== check.n) throw new Error(`the gateway saw ${seen} answer(s) to a ${method} request containing ${json}, not ${n}`)
      ctx.answered.push(check)
    }
  },
  quiet: {
    arity: 0,
    run: async ctx => {
      if (ctx.errors.length > 0) throw new Error(`the window logged ${ctx.errors.length} error(s): ${ctx.errors[0]}`)
    }
  },
  'quiet-except': {
    arity: 1,
    run: async (ctx, pattern) => {
      if (!isPattern(pattern)) throw new Error(`quiet-except takes a /regex/, not ${JSON.stringify(pattern)}`)
      const allowed = new RegExp(pattern.slice(1, -1))
      const [passed, others] = [ctx.errors.filter(error => allowed.test(error)), ctx.errors.filter(error => !allowed.test(error))]
      log(ctx, `  ${passed.length} error(s) matched ${pattern}`)
      if (others.length > 0) throw new Error(`the window logged ${others.length} other error(s): ${others[0]}`)
    }
  }
}

/** The fixture's dev server, as this run serves it. */
const served = (ctx, text) => (ctx.origin === null ? text : text.replaceAll(DEV_ORIGIN, ctx.origin))

/** Reads the pane's page in main: the view main drew over the window, beside the window's own. null while there is none. */
const inPreview = (ctx, what) => ctx.app.evaluate(async ({ BrowserWindow }, what) => {
  const window = BrowserWindow.getAllWindows()[0]
  const view = window?.contentView.children.find(child => child.webContents !== undefined && child.webContents !== window.webContents)
  if (view === undefined || view.webContents.isDestroyed()) return null
  const contents = view.webContents
  if (what === 'text') return contents.executeJavaScript('document.body ? document.body.innerText : ""')
  const state = { url: contents.getURL(), loading: contents.isLoading(), visible: view.getVisible(), bounds: view.getBounds() }
  if (what === 'state' || !state.visible) return state
  return { ...state, png: (await contents.capturePage()).toPNG().toString('base64') }
}, what)

async function poll(ctx, read, done) {
  const deadline = Date.now() + ctx.timeout
  for (;;) {
    const held = await read()
    if (done(held) || Date.now() > deadline) return held
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}

const contains = (actual, expected) => expected !== null && typeof expected === 'object' && !Array.isArray(expected)
  ? actual !== null && typeof actual === 'object' && Object.entries(expected).every(([key, value]) => contains(actual[key], value))
  : JSON.stringify(actual) === JSON.stringify(expected)

function callsLike(ctx, { method, expected }) {
  if (!existsSync(ctx.calls)) return 0
  return readFileSync(ctx.calls, 'utf8').split('\n').filter(line => line.trim() !== '').map(line => JSON.parse(line))
    .filter(frame => frame.method === method && contains(frame.params, expected)).length
}

/** A result or error frame names only the id of the request it answers. The fixture's request frames say which method that id is. */
function answersLike(ctx, { method, expected }) {
  if (!existsSync(ctx.calls)) return 0
  const lines = path => readFileSync(path, 'utf8').split('\n').filter(line => line.trim() !== '').map(line => JSON.parse(line))
  const asked = new Set(lines(ctx.fixture).filter(step => step.push?.method === method && step.push.id !== undefined).map(step => step.push.id))
  return lines(ctx.calls).filter(frame => frame.method === undefined && asked.has(frame.id) && contains(frame, expected)).length
}

const isPattern = name => /^\/.+\/$/.test(name)
const nameMatcher = name => (isPattern(name) ? new RegExp(name.slice(1, -1)) : name)
const matching = (page, role, name) => page.getByRole(role, { name: nameMatcher(name), exact: true })
const byRole = (page, role, name) => (isPattern(name) ? matching(page, role, name).first() : matching(page, role, name))

const fail = message => {
  console.error(`highwing-verify: ${message}`)
  process.exit(1)
}

function parseOptions(argv, known) {
  const options = {}
  const rest = []
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (!arg.startsWith('--')) { rest.push(arg); continue }
    const [key, inline] = arg.slice(2).split(/=(.*)/s)
    if (!(key in known)) fail(`unknown option --${key}`)
    options[key] = known[key] === 'flag' ? true : inline ?? argv[++index]
  }
  return { options, rest }
}

const electronBinary = () => {
  const pathFile = join(dirname(requireDesktop.resolve('electron/package.json')), 'path.txt')
  return existsSync(pathFile) ? join(dirname(pathFile), 'dist', readFileSync(pathFile, 'utf8').trim()) : null
}

const newestMtime = dir => readdirSync(dir, { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile())
  .reduce((newest, entry) => Math.max(newest, statSync(join(entry.parentPath, entry.name)).mtimeMs), 0)

const SOURCES = [join(DESKTOP, 'src'), join(REPO, 'packages/hermes/src'), join(REPO, 'packages/thread/src')]
const buildIsStale = () => !existsSync(MAIN_JS) || Math.max(...SOURCES.map(newestMtime), statSync(join(DESKTOP, 'electron.vite.config.ts')).mtimeMs) > newestMtime(join(DESKTOP, 'out'))

const tsxLoader = () => {
  try { return pathToFileURL(createRequire(join(REPO, 'package.json')).resolve('tsx')).href } catch { return null }
}

/** The pids of fake tools from `bin` that are still running. The app must leave none behind when it quits. */
const toolsRunning = bin => readdirSync('/proc').filter(entry => /^\d+$/.test(entry)).filter(pid => {
  try { return readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes(bin) } catch { return false }
})

const pngSize = path => {
  const fd = openSync(path, 'r')
  const header = Buffer.alloc(24)
  readSync(fd, header, 0, 24, 0)
  closeSync(fd)
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) }
}

const alive = pid => {
  try { process.kill(pid, 0); return true } catch { return false }
}

const instances = () => existsSync(SCRATCH_ROOT)
  ? readdirSync(SCRATCH_ROOT).map(run => ({ run, pidFile: join(SCRATCH_ROOT, run, 'pid') }))
    .filter(({ pidFile }) => existsSync(pidFile))
    .map(({ run, pidFile }) => ({ run, pid: Number(readFileSync(pidFile, 'utf8')) }))
  : []

function doctor() {
  const checks = [
    ['node >= 22', Number(process.versions.node.split('.')[0]) >= 22, process.versions.node],
    ['xvfb-run on PATH', spawnSync('which', ['xvfb-run']).status === 0, 'needed so no window opens on the desktop'],
    ['magick on PATH', spawnSync('which', ['magick']).status === 0, 'needed by compare'],
    ['playwright-core installed', (() => { try { return Boolean(requireDesktop.resolve('playwright-core')) } catch { return false } })(), 'pnpm install'],
    ['electron binary downloaded', Boolean(electronBinary()) && existsSync(electronBinary()), electronBinary() ?? 'run: node -e "require(\'electron\')" in apps/desktop'],
    ['build present and newer than sources', !buildIsStale(), 'run: highwing-verify.mjs build'],
    ['tsx installed', Boolean(tsxLoader()), 'needed to run the fake host; pnpm install']
  ]
  for (const [name, ok, detail] of checks) console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  (${detail})`}`)
  const running = instances().filter(({ pid }) => alive(pid))
  console.log(running.length === 0 ? 'ok   no verify instance running' : `note ${running.length} verify instance(s) running: ${running.map(({ run, pid }) => `${run} pid ${pid}`).join(', ')}`)
  process.exit(checks.every(([, ok]) => ok) ? 0 : 1)
}

function build() {
  const result = spawnSync('pnpm', ['--filter', '@highwing/desktop', 'build'], { cwd: REPO, stdio: 'inherit' })
  process.exit(result.status ?? 1)
}

function requestText(fixturePath) {
  for (const line of readFileSync(fixturePath, 'utf8').split('\n').slice(1)) {
    if (!line.trim()) continue
    const step = JSON.parse(line)
    if (step.await === 'prompt.submit') return step.params.text
  }
  fail(`${fixturePath} has no prompt.submit step, so @request means nothing`)
}

const MASK = '•••'
function expand(ctx, text) {
  if (text === '@request') return requestText(ctx.fixture ?? fail('@request needs --fixture'))
  if (text === '@webapp') return ctx.web?.url ?? fail('@webapp needs --fake-webapp or --webapp-url')
  return text
}

const PRIVATE_FIELDS = 'input[type=password], [data-private] input'

async function secretField(ctx, verb, label, text) {
  const field = ctx.page.getByLabel(label, { exact: true })
  const secret = await field.evaluate((input, selector) => input.matches(selector), PRIVATE_FIELDS, { timeout: ctx.timeout })
  if (secret) {
    ctx.secretLabels.add(label)
    if (text !== '') ctx.secrets.add(text)
  }
  log(ctx, `${verb} ${JSON.stringify(label)} ${secret ? JSON.stringify(MASK) : JSON.stringify(text)}`)
  return field
}

/** Each way a typed password can be written: as typed, and escaped inside a JSON or YAML string. */
const writtenForms = secret => [secret, JSON.stringify(secret).slice(1, -1)]

const aliased = (ctx, text) => (ctx.realHost === null ? text : text.split(ctx.realHost).join(STAND_IN_HOST))

const masked = (ctx, text) => aliased(ctx, [...ctx.secrets].flatMap(writtenForms).reduce((out, form) => out.split(form).join(MASK), text))

/** A snapshot writes a textbox's value after its name, escaped. A password field's value is replaced before anything matches on it. */
function maskedSnapshot(snapshot, labels) {
  const names = labels.map(label => `- textbox ${JSON.stringify(label)}`)
  return snapshot.split('\n').map(line => {
    const head = line.trimStart()
    if (!names.some(name => head === name || head.startsWith(`${name}:`) || head.startsWith(`${name} [`))) return line
    const colon = line.indexOf(': ', line.length - head.length)
    return colon === -1 ? line : `${line.slice(0, colon)}: ${MASK}`
  }).join('\n')
}

async function capture(ctx, path, options) {
  await ctx.page.evaluate(([selector, mask, host, standIn]) => {
    globalThis.highwingVerifyTyped = new Map([...document.querySelectorAll(selector)].filter(input => input.value !== '').map(input => [input, input.value]))
    for (const input of globalThis.highwingVerifyTyped.keys()) input.value = mask
    globalThis.highwingVerifyNamed = []
    if (host === null) return
    for (const input of document.querySelectorAll('input, textarea')) {
      if (globalThis.highwingVerifyTyped.has(input) || !input.value.includes(host)) continue
      globalThis.highwingVerifyTyped.set(input, input.value)
      input.value = input.value.split(host).join(standIn)
    }
    const texts = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let node = texts.nextNode(); node !== null; node = texts.nextNode()) {
      if (!node.data.includes(host)) continue
      const drawn = node.data.split(host).join(standIn)
      globalThis.highwingVerifyNamed.push([node, node.data, drawn])
      node.data = drawn
    }
  }, [PRIVATE_FIELDS, MASK, ctx.realHost, STAND_IN_HOST])
  try {
    await ctx.page.screenshot({ path, ...options })
    const shown = await ctx.page.locator(PRIVATE_FIELDS).evaluateAll((inputs, mask) => inputs.filter(input => input.value !== '' && input.value !== mask).length, MASK)
    if (shown > 0) ctx.exposed.push(path)
  } finally {
    await ctx.page.evaluate(() => {
      for (const [input, value] of globalThis.highwingVerifyTyped ?? []) input.value = value
      for (const [node, text, drawn] of globalThis.highwingVerifyNamed ?? []) if (node.data === drawn) node.data = text
      delete globalThis.highwingVerifyTyped
      delete globalThis.highwingVerifyNamed
    })
  }
}

const filesUnder = dir => (existsSync(dir) ? readdirSync(dir, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name)) : [])

function leaked(ctx, tokens = []) {
  const forms = [...ctx.secrets].flatMap(writtenForms)
  const holds = (path, texts) => texts.length > 0 && texts.some(text => readFileSync(path, 'latin1').includes(text))
  const evidence = filesUnder(ctx.evidence).filter(path => !path.endsWith('.png'))
  return [
    ...ctx.exposed,
    ...evidence.filter(path => forms.some(form => readFileSync(path, 'utf8').includes(form))),
    ...[...evidence, ...filesUnder(ctx.userData)].filter(path => holds(path, tokens))
  ]
}

const signInPages = ctx => opensRecorded(ctx).filter(call => call.action === 'browse' && call.url.startsWith(`${ctx.web?.url}/auth/native/authorize?`)).map(call => call.url)

function log(ctx, line) {
  const stamped = `${new Date().toISOString()} ${masked(ctx, line)}`
  console.log(stamped)
  appendFileSync(join(ctx.evidence, 'steps.log'), `${stamped}\n`)
}

function draftsOnDisk(ctx) {
  const dir = join(ctx.userData, 'drafts')
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter(name => name.endsWith('.json')).sort().map(name => {
    const raw = readFileSync(join(dir, name), 'utf8')
    try {
      const { key, text } = JSON.parse(raw)
      return { name, body: `key ${JSON.stringify(key)} text ${JSON.stringify(text)}` }
    } catch {
      return { name, body: `unreadable ${JSON.stringify(raw)}` }
    }
  })
}

const jsonLines = file => existsSync(file)
  ? readFileSync(file, 'utf8').split('\n').filter(line => line.trim() !== '').map(line => JSON.parse(line))
  : []
const opensRecorded = ctx => jsonLines(ctx.opens)
const noticesRecorded = ctx => jsonLines(ctx.notices)
const menusRecorded = ctx => jsonLines(ctx.menus)

const MENU_RETRY_MS = 200
const MENU_SETTLE_MS = 500

/** The spellchecker marks a word some time after it is typed, so the key is pressed again until a menu shows the label, or stops showing it. */
async function pressForMenu(ctx, key, label, wanted) {
  const deadline = Date.now() + ctx.timeout
  let last = null
  for (let presses = 1; Date.now() <= deadline; presses++) {
    const before = menusRecorded(ctx).length
    await ctx.page.keyboard.press(key)
    const menus = await poll(ctx, async () => menusRecorded(ctx), menus => menus.length > before)
    if (menus.length === before) throw new Error(`main recorded no menu within ${ctx.timeout} ms of pressing ${key}`)
    last = menus.at(-1)
    if (last.items.includes(label) === wanted) {
      log(ctx, `  menu ${wanted ? 'with' : 'without'} "${label}" after ${presses} press(es): ${JSON.stringify(last)}`)
      return
    }
    await new Promise(resolve => setTimeout(resolve, MENU_RETRY_MS))
  }
  throw new Error(`no menu ${wanted ? 'held' : 'left out'} "${label}" within ${ctx.timeout} ms. The last one: ${JSON.stringify(last)}`)
}

async function pollUntil(ctx, read, done) {
  const deadline = Date.now() + ctx.timeout
  for (;;) {
    const value = await read()
    if (done(value)) return value
    if (Date.now() > deadline) throw new Error(`still ${JSON.stringify(value)} after ${ctx.timeout} ms`)
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}

/** Polls without backoff: Playwright's own `waitFor` spaces polls up to 500 ms apart and misses brief states. */
async function waitFor(ctx, state) {
  const locate = STATES[state] ?? fail(`unknown state "${state}". Known: ${Object.keys(STATES).join(', ')}`)
  const locator = locate(ctx.page)
  const deadline = Date.now() + ctx.timeout
  while (!(await locator.isVisible())) {
    if (Date.now() > deadline) throw new Error(`state "${state}" did not appear within ${ctx.timeout} ms`)
  }
  log(ctx, `  ${state} ${Date.now() - ctx.launched} ms after launch`)
  ctx.holding = state
}

/** Polls like `waitFor`: the control's fade ends 150 ms after the state changes, and a missed poll is a false pass. */
async function waitGone(ctx, role, name) {
  const locator = matching(ctx.page, role, name)
  const deadline = Date.now() + ctx.timeout
  while ((await locator.count()) > 0 && (await locator.first().isVisible())) {
    if (Date.now() > deadline) throw new Error(`${role} "${name}" still visible after ${ctx.timeout} ms`)
  }
}

async function checkInView(ctx, role, name) {
  const locator = byRole(ctx.page, role, name)
  await locator.first().waitFor({ state: 'visible', timeout: ctx.timeout })
  const problem = await locator.first().evaluate(element => {
    const box = element.getBoundingClientRect()
    const outside = (rect, label) => (box.top < rect.top - 0.5 || box.bottom > rect.bottom + 0.5 || box.left < rect.left - 0.5 || box.right > rect.right + 0.5
      ? `${label} spans ${Math.round(rect.top)}..${Math.round(rect.bottom)} but the element spans ${Math.round(box.top)}..${Math.round(box.bottom)}`
      : null)
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const { overflowX, overflowY } = getComputedStyle(parent)
      if (/(auto|scroll|hidden|clip)/.test(overflowX + overflowY)) {
        const rect = parent.getBoundingClientRect()
        const found = outside({ top: rect.top + parent.clientTop, bottom: rect.top + parent.clientTop + parent.clientHeight, left: rect.left + parent.clientLeft, right: rect.left + parent.clientLeft + parent.clientWidth }, `<${parent.localName}${parent.id ? `#${parent.id}` : ''}>`)
        if (found) return found
      }
    }
    return outside({ top: 0, bottom: innerHeight, left: 0, right: innerWidth }, 'window')
  })
  if (problem) throw new Error(`${role} "${name}" is not fully in view: ${problem}`)
}

async function sizeWindow(ctx, options) {
  const [width, height] = (options.size ?? `${SIZE.width}x${SIZE.height}`).split('x').map(Number)
  ctx.size = { width, height }
  if (options['chat-only']) {
    await STATES.window(ctx.page).waitFor({ state: 'visible', timeout: ctx.timeout })
    const left = await ctx.page.evaluate(() => document.querySelector('.screen')?.getBoundingClientRect().left ?? null)
    if (left === null) throw new Error('--chat-only found no .screen to clip to')
    ctx.clip = { x: left, y: 0, width, height }
  }
  const content = { width: width + (ctx.clip?.x ?? 0), height }
  if (content.width === SIZE.width && content.height === SIZE.height) return
  await ctx.app.evaluate(({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height)
  }, content)
  await ctx.page.waitForFunction(size => innerWidth === size.width && innerHeight === size.height, content, { timeout: ctx.timeout })
    .catch(() => { throw new Error(`the window did not become ${content.width}x${content.height}`) })
}

async function shoot(ctx, name) {
  const path = join(ctx.evidence, `${name}.png`)
  await ctx.page.mouse.move(0, 0)
  await capture(ctx, path, { animations: 'disabled', caret: 'hide', ...(ctx.clip && { clip: ctx.clip }) })
  await drawPreview(ctx, path)
  const fields = await ctx.page.locator(PRIVATE_FIELDS).evaluateAll(inputs => inputs.map(input => ({ label: input.getAttribute('aria-label') ?? '', value: input.value })))
  for (const { value } of fields) if (value !== '') ctx.secrets.add(value)
  const snapshot = maskedSnapshot(await ctx.page.locator('body').ariaSnapshot(), [...ctx.secretLabels, ...fields.map(field => field.label)])
  writeFileSync(join(ctx.evidence, `${name}.aria.txt`), masked(ctx, snapshot))
  const size = pngSize(path)
  if (size.width !== ctx.size.width || size.height !== ctx.size.height) throw new Error(`${name}.png is ${size.width}x${size.height}, not ${ctx.size.width}x${ctx.size.height}`)
  if (ctx.holding && !(await STATES[ctx.holding](ctx.page).isVisible())) {
    throw new Error(`state "${ctx.holding}" ended before ${name}.png was taken, so the shot may show a later moment`)
  }
  log(ctx, `  saved ${path} (state "${ctx.holding ?? 'none'}" still held)`)
}

/** A page screenshot cannot see the view main draws the previewed page in, so the view's own capture goes on top at its place. */
async function drawPreview(ctx, path) {
  const view = await inPreview(ctx, 'capture')
  if (view?.png === undefined) return
  const page = join(ctx.evidence, '.preview-capture.png')
  writeFileSync(page, Buffer.from(view.png, 'base64'))
  const at = `+${view.bounds.x - (ctx.clip?.x ?? 0)}+${view.bounds.y - (ctx.clip?.y ?? 0)}`
  const result = spawnSync('magick', [path, page, '-geometry', at, '-composite', path], { stdio: 'inherit' })
  rmSync(page, { force: true })
  if (result.status !== 0) throw new Error(`magick could not draw the previewed page onto ${path}`)
  log(ctx, `  drew the previewed page ${view.url} at ${at}`)
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' }

/** Serves `dir` on a port of the loopback for the run, as the fixture's dev server. Resolves with its origin. */
function serve(dir) {
  const root = resolve(process.cwd(), dir)
  if (!existsSync(root) || !statSync(root).isDirectory()) fail(`--serve needs a folder, and ${root} is not one`)
  const server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname)
    const file = join(root, path.endsWith('/') ? `${path}index.html` : path)
    if (!file.startsWith(`${root}${sep}`) || !existsSync(file) || !statSync(file).isFile()) return void response.writeHead(404).end()
    response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file))
  })
  return new Promise(done => server.listen(0, '127.0.0.1', () => done({ server, origin: `http://127.0.0.1:${server.address().port}` })))
}

function parseSteps(words) {
  const steps = []
  for (let index = 0; index < words.length;) {
    const verb = words[index]
    const step = STEPS[verb] ?? fail(`unknown step "${verb}". Known: ${Object.keys(STEPS).join(', ')}`)
    const args = words.slice(index + 1, index + 1 + step.arity)
    if (args.length < step.arity) fail(`"${verb}" needs ${step.arity} argument(s)`)
    steps.push({ verb, args })
    index += 1 + step.arity
  }
  return steps
}

/** The X server on our display must be the one our own xvfb-run started, or a teardown elsewhere kills this run. */
function ownDisplay() {
  const number = (process.env.DISPLAY ?? '').replace(/^:/, '').split('.')[0]
  const lock = `/tmp/.X${number}-lock`
  const server = existsSync(lock) ? Number(readFileSync(lock, 'utf8').trim()) : NaN
  const parent = existsSync(`/proc/${server}/stat`) ? Number(readFileSync(`/proc/${server}/stat`, 'utf8').split(') ')[1]?.split(' ')[1]) : NaN
  if (parent !== process.ppid) fail(`display ${process.env.DISPLAY} belongs to another run's X server. Start this run again.`)
}

const ANSWER_CALLS = new Set(['clarify.lock', 'connection.respond'])
const ACTED_CALLS = new Set([
  'prompt.resolve_unknown', 'prompt.replace_queued', 'prompt.cancel', 'prompt.steer_queued', 'session.steer', 'session.redirect', 'session.export',
  'process.kill', 'session.control', 'rollback.list', 'rollback.diff', 'rollback.restore', 'message.react'
])

/**
 * Hermes streams a reply in pieces and may cut the dev server's URL in two. Each segment's pieces are
 * joined, the origin is put in, and the text is cut again where it was, a cut inside the URL moving to
 * its end. The offsets follow the new lengths.
 */
function serveInDeltas(steps, origin) {
  const segments = Map.groupBy(
    steps.map(step => step.push?.params).filter(params => params?.type === 'message.delta' && typeof params.payload?.text === 'string'),
    params => `${params.admission_id} ${params.payload.turn_id} ${params.payload.segment}`
  )
  const grown = origin.length - DEV_ORIGIN.length
  for (const pieces of segments.values()) {
    const old = pieces.map(params => params.payload.text).join('')
    const matches = []
    for (let at = old.indexOf(DEV_ORIGIN); at !== -1; at = old.indexOf(DEV_ORIGIN, at + 1)) matches.push({ start: at, end: at + DEV_ORIGIN.length })
    const moved = cut => {
      const inside = matches.find(({ start, end }) => start < cut && cut < end)
      const at = inside?.end ?? cut
      return at + grown * matches.filter(({ end }) => end <= at).length
    }
    const text = old.replaceAll(DEV_ORIGIN, origin)
    const first = pieces[0].payload.offset
    let from = 0
    let read = 0
    for (const params of pieces) {
      read += params.payload.text.length
      const to = moved(read)
      params.payload.text = text.slice(from, to)
      if (typeof first === 'number') params.payload.offset = first + from
      from = to
    }
  }
}

const requestMethods = steps => new Map(steps.flatMap(step => {
  if (step.push?.method !== undefined && step.push.id !== undefined) return [[step.push.id, step.push.method]]
  return step.push?.params?.type === 'connection.request' ? [[step.push.params.payload.op_id, 'connection']] : []
}))

const answerTo = step => step.answer ?? step.params?.request_id ?? step.params?.op_id

function withEdits(fixturePath, { dropAfter, models, catalog, guarded, usage, profiles, paths, createWarnings, configureClash, assetFails, images, pets, bound, noBotChat, tree, yolo, yoloDenied, yoloElsewhereAfter, answeredElsewhere, answerHere, cancel, actedElsewhere, windowMakes, origin, attachLimit }, out) {
  const lines = readFileSync(fixturePath, 'utf8').split('\n').filter(line => line.trim() !== '')
  const header = JSON.parse(lines[0])
  const recorded = lines.slice(1).map(line => JSON.parse(line))
  const methods = requestMethods(recorded)
  const here = new Set((answerHere ?? '').split(',').filter(Boolean))
  const wanted = step => (('answer' in step && 'result' in step) || ANSWER_CALLS.has(step.await)) && here.has(methods.get(answerTo(step)))
  const answered = answeredElsewhere ? recorded.filter(step => wanted(step) || (!('result' in step && 'answer' in step) && !ANSWER_CALLS.has(step.await))) : recorded
  const made = new Set(windowMakes?.split(',') ?? [])
  const madeHere = step => made.has(step.await) || made.has(`${step.await}:${step.params?.action}`)
  let steps = actedElsewhere ? answered.filter(step => !ACTED_CALLS.has(step.await) || madeHere(step)) : answered
  if (origin) {
    serveInDeltas(steps, origin)
    steps.splice(0, steps.length, ...steps.map(step => JSON.parse(JSON.stringify(step).replaceAll(DEV_ORIGIN, origin))))
  }
  if (cancel) {
    const [method, reason] = cancel.split('=')
    const id = steps.find(step => step.push?.method === method && step.push.id !== undefined)?.push.id ?? fail(`${fixturePath} asks no ${method} request`)
    const withdrawal = steps.find(step => step.push?.params?.type === 'request.cancel' && step.push.params.payload?.id === id) ?? fail(`${fixturePath} never cancels the ${method} request`)
    withdrawal.push.params.payload.reason = reason
    steps = steps.filter(step => step.answer !== id)
  }
  if (models) header.models = JSON.parse(readFileSync(resolve(process.cwd(), models), 'utf8'))
  if (catalog) header.catalog = JSON.parse(readFileSync(resolve(process.cwd(), catalog), 'utf8'))
  if (guarded) header.guarded = guarded.split(',')
  if (usage) header.usage = JSON.parse(readFileSync(resolve(process.cwd(), usage), 'utf8'))
  if (profiles) {
    const { chats, relay, souls, groups, ...reply } = JSON.parse(readFileSync(resolve(process.cwd(), profiles), 'utf8'))
    header.profiles = reply
    if (chats !== undefined) header.chats = chats
    if (relay !== undefined) header.relay = relay
    if (souls !== undefined) header.souls = souls
    if (groups !== undefined) header.groups = groups
  }
  if (paths) header.paths = JSON.parse(readFileSync(resolve(process.cwd(), paths), 'utf8'))
  if (createWarnings) header.createWarnings = JSON.parse(readFileSync(resolve(process.cwd(), createWarnings), 'utf8'))
  if (configureClash) header.configureClash = configureClash
  if (assetFails) header.assetFails = assetFails
  if (images) header.images = JSON.parse(readFileSync(resolve(process.cwd(), images), 'utf8'))
  if (pets) header.pets = JSON.parse(readFileSync(resolve(process.cwd(), pets), 'utf8'))
  if (bound) header.reach = 'profile'
  if (noBotChat) header.homeBotChat = false
  if (tree) header.tree = true
  if (yolo) header.yolo = yolo === 'on'
  if (yoloDenied) header.yoloDenied = true
  if (attachLimit) header.attachLimits = { image: Number(attachLimit), file: Number(attachLimit) }
  if (yoloElsewhereAfter) {
    const at = steps.findIndex(step => step.push?.params?.type === yoloElsewhereAfter)
    if (at === -1) fail(`${fixturePath} pushes no ${yoloElsewhereAfter} frame`)
    const { session_id, replay_epoch, seq } = steps[at].push.params
    const turnedOnAt = Math.min(steps[at].at + 50, steps[at + 1]?.at ?? Infinity)
    for (const step of steps.slice(at + 1)) {
      if (step.push?.method === 'event' && step.push.params?.session_id === session_id && Number.isInteger(step.push.params.seq)) step.push.params.seq++
    }
    const info = { jsonrpc: '2.0', method: 'event', params: { type: 'session.info', session_id, replay_epoch, seq: seq + 1, payload: { yolo: true } } }
    steps.splice(at + 1, 0, { at: turnedOnAt, push: info })
  }
  if (dropAfter) {
    const at = steps.findIndex(step => step.push?.params?.type === dropAfter || step.push?.method === dropAfter)
    if (at === -1) fail(`${fixturePath} pushes no ${dropAfter} frame`)
    const dropAt = Math.min(steps[at].at + 50, steps[at + 1]?.at ?? Infinity)
    steps.splice(at + 1, 0, { at: dropAt, drop: 1006 })
  }
  writeFileSync(out, [header, ...steps].map(line => JSON.stringify(line)).join('\n') + '\n')
  return out
}

/**
 * Starts the fake Hermes machine in its own process and resolves with the bin directory of its fake
 * ssh, tailscale and hermes. The app is then launched with that directory as its whole PATH, so it
 * cannot reach the real ones.
 */
function startFakeHost(scenario, fixture, holdAt, scratch) {
  const child = spawn(process.execPath, ['--import', tsxLoader() ?? fail('tsx is missing; run doctor'), join(REPO, 'scripts/fake-host.ts'), scenario, fixture, ...(holdAt ? [holdAt] : [])], {
    cwd: REPO, stdio: ['ignore', 'pipe', 'inherit']
  })
  writeFileSync(join(scratch, 'host-pid'), String(child.pid))
  return new Promise(resolve => {
    let text = ''
    child.stdout.on('data', chunk => {
      text += chunk
      if (text.includes('\n')) resolve({ child, bin: JSON.parse(text).bin })
    })
    child.on('exit', code => fail(`the fake host exited with code ${code} before the run ended`))
  })
}

function addressOf(text) {
  const url = URL.parse(text)
  if (url === null || (url.protocol !== 'https:' && url.protocol !== 'http:') || url.username !== '' || url.search !== '' || url.hash !== '') fail(`--webapp-url takes the http or https address of a gateway's Webapp, with no username, ? or # part`)
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`
}

function jsonLinesOf(stream) {
  const waiting = []
  const read = []
  let text = ''
  stream.on('data', chunk => {
    text += chunk
    for (let end = text.indexOf('\n'); end !== -1; end = text.indexOf('\n')) {
      const line = JSON.parse(text.slice(0, end))
      text = text.slice(end + 1)
      const next = waiting.shift()
      if (next) next(line)
      else read.push(line)
    }
  })
  return () => (read.length > 0 ? Promise.resolve(read.shift()) : new Promise(resolve => waiting.push(resolve)))
}

async function startFakeWebapp(scenario, fixture, user, scratch) {
  const child = spawn(process.execPath, ['--import', tsxLoader() ?? fail('tsx is missing; run doctor'), join(REPO, 'scripts/fake-webapp.ts'), scenario, fixture, ...(user ? [user.usernameFile, user.passwordFile] : [])], {
    cwd: REPO, stdio: ['pipe', 'pipe', 'inherit']
  })
  writeFileSync(join(scratch, 'host-pid'), String(child.pid))
  child.on('exit', code => fail(`the fake Webapp exited with code ${code} before the run ended`))
  const nextLine = jsonLinesOf(child.stdout)
  const tell = order => void child.stdin.write(`${order}\n`)
  const { url } = await nextLine()
  return { child, url, tell, secrets: async () => (tell('secrets'), (await nextLine()).secrets) }
}

function credentials(ctx) {
  const [username, password] = USER_FILES.map(name => readFileSync(process.env[name], 'utf8').replace(/\r?\n$/, ''))
  ctx.secrets.add(username).add(password)
  return { username, password }
}

const CALLBACK = /^http:\/\/127\.0\.0\.1:\d+\/callback\?/

async function signInOnPage(ctx, url, n) {
  const { username, password } = credentials(ctx)
  const { _electron } = requireDesktop('playwright-core')
  const { executable, cwd, env, scratch } = ctx.launch
  const browser = await _electron.launch({
    executablePath: executable, cwd, env, timeout: ctx.timeout,
    args: [BROWSER_JS, '--ozone-platform=x11', '--force-device-scale-factor=1', '--disable-gpu', `--user-data-dir=${join(scratch, 'browser-data')}`]
  })
  const { pid } = browser.process()
  writeFileSync(join(scratch, 'browser-pid'), String(pid))
  const first = (what, waits) => Promise.any(waits).catch(() => { throw new Error(`the browser reached ${what} within ${ctx.timeout} ms`) })
  try {
    const page = await browser.firstWindow({ timeout: ctx.timeout })
    await page.goto(url, { timeout: ctx.timeout })
    const form = page.locator('form.provider-form').first()
    const reached = await first("neither Hermes's sign-in form nor Highwing's callback", [
      form.locator('input[name=password]').waitFor({ state: 'visible', timeout: ctx.timeout }).then(() => 'form'),
      page.waitForURL(CALLBACK, { timeout: ctx.timeout }).then(() => 'callback')
    ])
    if (reached === 'form') {
      await page.screenshot({ path: join(ctx.evidence, `sign-in-page-${n}.png`) })
      await form.locator('input[name=username]').fill(username)
      await form.locator('input[name=password]').fill(password)
      await form.locator('button[type=submit]').click()
      const refused = form.locator('.form-error')
      const ended = await first("neither Highwing's callback nor an error on the form", [
        page.waitForURL(CALLBACK, { timeout: ctx.timeout }).then(() => null),
        refused.waitFor({ state: 'visible', timeout: ctx.timeout }).then(() => refused.textContent())
      ])
      if (ended !== null) throw new Error(`Hermes's sign-in page said: ${ended}`)
    }
    log(ctx, `  sign-in ${n}: the browser ${reached === 'form' ? "filled Hermes's form and" : 'was already signed in and'} reached Highwing's callback`)
  } finally {
    await Promise.race([browser.close().catch(() => {}), new Promise(done => setTimeout(done, QUIT_MS))])
    if (alive(pid)) process.kill(pid, 'SIGKILL')
    rmSync(join(scratch, 'browser-pid'), { force: true })
  }
}

function browseSignIns(ctx, signIn) {
  let answered = 0
  let busy = false
  const timer = setInterval(async () => {
    const pages = signInPages(ctx)
    if (busy || pages.length <= answered) return
    busy = true
    answered++
    try {
      await signIn(pages[answered - 1], answered)
    } catch (error) {
      ctx.signInFailures.push(error.message.split('\n')[0])
      log(ctx, `  sign-in ${answered} FAILED: ${error.message.split('\n')[0]}`)
    } finally {
      busy = false
    }
  }, 50)
  return () => clearInterval(timer)
}

async function launchApp(ctx) {
  const { _electron } = requireDesktop('playwright-core')
  const { executable, args, cwd, env, arg, evidence, scratch, media, options } = ctx.launch
  ctx.launched = Date.now()
  const [videoWidth, videoHeight] = (options.size ?? `${SIZE.width}x${SIZE.height}`).split('x').map(Number)
  ctx.app = await _electron.launch({
    executablePath: executable, args: arg === undefined ? args : [...args, arg], cwd, env, timeout: ctx.timeout,
    ...(options.video && { recordVideo: { dir: join(scratch, 'video'), size: { width: videoWidth, height: videoHeight } } })
  })
  ctx.pid = ctx.app.process().pid
  writeFileSync(join(scratch, 'pid'), String(ctx.pid))
  const mainLog = join(evidence, 'main.log')
  ctx.app.process().stdout?.on('data', chunk => appendFileSync(mainLog, chunk))
  ctx.app.process().stderr?.on('data', chunk => appendFileSync(mainLog, chunk))
  ctx.page = await ctx.app.firstWindow({ timeout: ctx.timeout })
  if (Object.keys(media).length > 0) await ctx.page.emulateMedia(media)
  ctx.page.on('console', message => {
    appendFileSync(join(evidence, 'console.log'), `${message.type()} ${message.text()}\n`)
    if (message.type() === 'error') ctx.errors.push(message.text())
  })
  ctx.page.on('pageerror', error => {
    appendFileSync(join(evidence, 'console.log'), `pageerror ${error.stack ?? error}\n`)
    ctx.errors.push(String(error.message ?? error))
  })
  ctx.page.on('dialog', dialog => {
    const opened = `${dialog.type()} ${JSON.stringify(dialog.message())}`
    ctx.dialogs.push(opened)
    log(ctx, `DIALOG ${opened}`)
    dialog.dismiss().catch(() => {})
  })
  await ctx.page.waitForLoadState('domcontentloaded')
  ctx.home = ctx.page.url()
  await sizeWindow(ctx, options)
}

/** A tool the app left running holds the app's pipes open, and close() would then wait on it for ever. */
async function quitApp(ctx) {
  await Promise.race([ctx.app.close().catch(() => {}), new Promise(done => setTimeout(done, QUIT_MS))])
  if (alive(ctx.pid)) process.kill(ctx.pid, 'SIGKILL')
  rmSync(join(ctx.launch.scratch, 'pid'), { force: true })
}

async function run(argv) {
  ownDisplay()
  const { options, rest } = parseOptions(argv, { fixture: 'value', run: 'value', timeout: 'value', 'drop-after': 'value', models: 'value', catalog: 'value', guarded: 'value', usage: 'value', profiles: 'value', paths: 'value', 'create-warnings': 'value', 'configure-clash': 'value', 'asset-fails': 'value', images: 'value', pets: 'value', video: 'flag', 'pick-file': 'value', pick: 'value', 'menu-pick': 'value', 'attach-limit': 'value', bound: 'flag', 'no-bot-chat': 'flag', tree: 'flag', yolo: 'value', 'yolo-denied': 'flag', 'yolo-elsewhere-after': 'value', serve: 'value', 'fake-host': 'value', 'hold-at': 'value', saved: 'value', 'fake-webapp': 'value', 'webapp-url': 'value', 'login-form': 'flag', keyring: 'value', 'sign-in-ms': 'value', mode: 'value', 'forced-colors': 'flag', 'more-contrast': 'flag', size: 'value', 'chat-only': 'flag', 'answered-elsewhere': 'flag', 'acted-elsewhere': 'flag', 'window-makes': 'value', 'answer-here': 'value', cancel: 'value', arg: 'value' })
  const steps = parseSteps(rest)
  const scenario = options['fake-host']
  const webScenario = options['fake-webapp']
  const realUrl = options['webapp-url'] ? addressOf(options['webapp-url']) : null
  const byAddress = Boolean(webScenario || realUrl)
  if ([scenario, webScenario, realUrl].filter(Boolean).length > 1) fail('--fake-host, --fake-webapp and --webapp-url each name the gateway of a run. Pass one of them')
  if (!options.fixture && !scenario && !byAddress) fail('pass --fixture <path> to replay a recorded gateway, --fake-host <scenario> to launch against the fake Hermes machine, --fake-webapp <scenario> to launch against the fake Hermes Webapp, or --webapp-url <url> to reach a real one')
  if (!scenario && !byAddress && options.saved) fail('--saved needs --fake-host, --fake-webapp or --webapp-url: without one the app would run the real ssh, tailscale and hermes')
  if (!scenario && options['hold-at']) fail('--hold-at needs --fake-host, because it holds one of the fake machine\'s tools')
  if (realUrl && options.fixture) fail('--webapp-url reaches a real gateway, which plays no fixture')
  if (options['login-form'] && !webScenario) fail('--login-form needs --fake-webapp, because it puts Hermes\'s password form in front of the fake')
  if (options.keyring && !KEYRINGS.includes(options.keyring)) fail(`unknown --keyring "${options.keyring}". Known: ${KEYRINGS.join(', ')}`)
  if (options.keyring && !byAddress) fail('--keyring needs --fake-webapp or --webapp-url, because only a sign-in to a gateway address is kept')
  if (options.keyring === 'test' && realUrl) fail('--keyring test seals nothing, so it never keeps the sign-in of a real gateway. Use --keyring system, or none')
  if (options['sign-in-ms'] && (!byAddress || !/^[1-9]\d*$/.test(options['sign-in-ms']))) fail('--sign-in-ms takes a number of milliseconds, and needs --fake-webapp or --webapp-url')
  const signsInOnPage = Boolean(options['login-form'] || realUrl)
  if (signsInOnPage) for (const name of USER_FILES) if (!process.env[name]) fail(`set ${name} to a file that holds it, for the sign-in page`)
  const site = options.serve ? await serve(options.serve) : null
  const edits = { dropAfter: options['drop-after'], models: options.models, catalog: options.catalog, guarded: options.guarded, usage: options.usage, profiles: options.profiles, paths: options.paths, createWarnings: options['create-warnings'], configureClash: options['configure-clash'], assetFails: options['asset-fails'], images: options.images, pets: options.pets, bound: options.bound, noBotChat: options['no-bot-chat'], tree: options.tree, yolo: options.yolo, yoloDenied: options['yolo-denied'], yoloElsewhereAfter: options['yolo-elsewhere-after'], answeredElsewhere: options['answered-elsewhere'], answerHere: options['answer-here'], cancel: options.cancel, actedElsewhere: options['acted-elsewhere'], windowMakes: options['window-makes'], origin: site?.origin, attachLimit: options['attach-limit'] }
  const edited = Object.values(edits).some(Boolean)
  if (options.yolo && options.yolo !== 'on' && options.yolo !== 'off') fail(`--yolo takes on or off, not "${options.yolo}"`)
  if (options['window-makes'] && !options['acted-elsewhere']) fail('--window-makes needs --acted-elsewhere, because without it the window makes every call')
  if (options['answer-here'] && !options['answered-elsewhere']) fail('--answer-here needs --answered-elsewhere, because without it the window answers every request')
  if (options.cancel && !/^[^=]+=[^=]+$/.test(options.cancel)) fail(`--cancel takes <method>=<reason>, not "${options.cancel}"`)
  if (!options.yolo && (options['yolo-denied'] || options['yolo-elsewhere-after'])) fail('--yolo-denied and --yolo-elsewhere-after need --yolo, because a Hermes with no YOLO answers neither')
  if (options.tree && !options.profiles) fail('--tree needs --profiles, because the tree lists the chats that file seeds')
  if ((scenario || byAddress) && edited) fail('--drop-after, --models, --catalog, --guarded, --usage, --profiles, --paths, --create-warnings, --configure-clash, --asset-fails, --images, --pets, --bound, --no-bot-chat, --tree, --yolo, --yolo-denied, --yolo-elsewhere-after, --answered-elsewhere, --answer-here, --cancel, --acted-elsewhere, --serve and --attach-limit edit the fixture a --fixture run replays. They do nothing with --fake-host, --fake-webapp or --webapp-url')
  if (options['configure-clash'] && !options.profiles) fail('--configure-clash needs --profiles: without it Hermes has no bots to rename')
  if (options['asset-fails'] && !options.profiles) fail('--asset-fails needs --profiles: without it Hermes stores no pictures')
  if (options['attach-limit'] && !/^[1-9]\d*$/.test(options['attach-limit'])) fail(`--attach-limit takes a number of bytes, not "${options['attach-limit']}"`)
  if (options.saved && !(options.saved in SAVED)) fail(`unknown --saved "${options.saved}". Known: ${Object.keys(SAVED).join(', ')}`)
  const savedWith = SAVED_WITH[byAddress ? 'webapp' : 'host']
  if (options.saved && !savedWith.includes(options.saved)) fail(`--saved ${options.saved} does not go with ${byAddress ? 'a gateway address' : '--fake-host'}. Known there: ${savedWith.join(', ')}`)
  if (options.mode && !MODES.includes(options.mode)) fail(`unknown --mode "${options.mode}". Known: ${MODES.join(', ')}`)
  if (options.size && !/^[1-9]\d*x[1-9]\d*$/.test(options.size)) fail(`--size takes <width>x<height>, not "${options.size}"`)
  if (buildIsStale()) fail('the build is missing or older than the sources. Run: highwing-verify.mjs build')
  const runId = options.run ?? `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`
  const evidence = join(EVIDENCE_ROOT, runId)
  const scratch = join(SCRATCH_ROOT, runId)
  mkdirSync(evidence, { recursive: true })
  mkdirSync(scratch, { recursive: true })
  const given = options.fixture ? resolve(process.cwd(), options.fixture) : scenario || webScenario ? ERRAND : null
  const fixture = edited ? withEdits(given, edits, join(evidence, 'fixture-edited.jsonl')) : given
  const calls = join(evidence, 'gateway-calls.jsonl')
  rmSync(calls, { force: true })
  const userData = join(scratch, 'user-data')
  const ctx = { app: null, page: null, evidence, fixture, calls, userData, called: [], answered: [], errors: [], timeout: Number(options.timeout ?? 15_000), opens: join(evidence, 'opens.jsonl'), notices: join(evidence, 'notices.jsonl'), menus: join(evidence, 'menus.jsonl'), notified: [], holding: null, clipboard: null, size: SIZE, clip: null, origin: site?.origin ?? null, home: null, dialogs: [], secrets: new Set(), secretLabels: new Set(), exposed: [], web: null, realHost: realUrl ? new URL(realUrl).hostname : null, signInFailures: [], pid: null }
  const media = { ...(options['forced-colors'] && { forcedColors: 'active' }), ...(options['more-contrast'] && { contrast: 'more' }) }

  const userFiles = options['login-form'] ? { usernameFile: process.env.HIGHWING_VERIFY_USER_FILE, passwordFile: process.env.HIGHWING_VERIFY_PASSWORD_FILE } : null
  ctx.web = webScenario ? await startFakeWebapp(webScenario, fixture, userFiles, scratch) : realUrl ? { url: realUrl } : null
  const saved = SAVED[options.saved ?? 'none'](ctx.web?.url)
  if (scenario || byAddress) {
    rmSync(userData, { recursive: true, force: true })
    mkdirSync(userData, { recursive: true })
    if (saved !== null) writeFileSync(join(userData, SETTINGS_FILE), saved)
    // The check of this scenario passes. The save after it fails, because its temp file cannot be opened.
    if (scenario === 'cant-save') mkdirSync(join(userData, `${SETTINGS_FILE}.tmp`))
  }
  if (options.mode) {
    mkdirSync(userData, { recursive: true })
    writeFileSync(join(userData, MODE_FILE), JSON.stringify({ version: 1, mode: options.mode }))
  }
  const host = scenario ? await startFakeHost(scenario, fixture, options['hold-at'], scratch) : null

  const noTools = byAddress ? join(scratch, 'bin') : null
  if (noTools) {
    rmSync(noTools, { recursive: true, force: true })
    mkdirSync(noTools, { recursive: true })
    const dbusSend = options.keyring === 'system' ? spawnSync('which', ['dbus-send'], { encoding: 'utf8' }).stdout.trim() : ''
    if (dbusSend !== '') symlinkSync(dbusSend, join(noTools, 'dbus-send'))
  }
  const env = { ...process.env, ...(host ? { PATH: host.bin } : {}), ...(noTools ? { PATH: noTools } : {}) }
  delete env.WAYLAND_DISPLAY
  delete env.ELECTRON_RENDERER_URL
  delete env.HIGHWING_FIXTURE
  delete env.HIGHWING_RECORD
  delete env.HIGHWING_FIXTURE_CALLS
  if (!host && !byAddress) Object.assign(env, { HIGHWING_FIXTURE: fixture, HIGHWING_FIXTURE_CALLS: calls })
  delete env.HIGHWING_SIGN_IN_MS
  if (options['sign-in-ms']) env.HIGHWING_SIGN_IN_MS = options['sign-in-ms']
  delete env.HIGHWING_TEST_KEYRING
  if (options.keyring === 'test') env.HIGHWING_TEST_KEYRING = '1'
  rmSync(ctx.opens, { force: true })
  env.HIGHWING_OPEN_LOG = ctx.opens
  delete env.HIGHWING_PICK_FILE
  if (options['pick-file']) env.HIGHWING_PICK_FILE = resolve(process.cwd(), options['pick-file'])
  delete env.HIGHWING_PICK_FILES
  if (options.pick) env.HIGHWING_PICK_FILES = options.pick.split(',').map(path => resolve(process.cwd(), path)).join(delimiter)
  env.HIGHWING_SAVE_DIR = join(evidence, 'saves')
  rmSync(ctx.notices, { force: true })
  env.HIGHWING_NOTIFY_LOG = ctx.notices
  rmSync(ctx.menus, { force: true })
  env.HIGHWING_MENU_LOG = ctx.menus
  delete env.HIGHWING_MENU_PICK
  if (options['menu-pick']) env.HIGHWING_MENU_PICK = options['menu-pick']

  const gateway = host ? `the fake host "${scenario}" as the whole PATH, saved connection "${options.saved ?? 'none'}"`
    : byAddress ? `${webScenario ? `the fake Webapp "${webScenario}"${options['login-form'] ? " behind Hermes's password form" : ''}` : 'a real Webapp'} at ${ctx.web.url}, no tool on the PATH, saved connection "${options.saved ?? 'none'}", ${options.keyring ? `the ${options.keyring} keyring` : 'no keyring'}`
      : `HIGHWING_FIXTURE=${fixture}`
  log(ctx, `run ${runId}: launching on ${process.env.DISPLAY} with ${gateway}${Object.keys(media).length > 0 ? `, emulating ${JSON.stringify(media)}` : ''}${options.arg === undefined ? '' : `, with the argument ${JSON.stringify(options.arg)}`}`)
  const executable = electronBinary() ?? fail('electron binary missing; run doctor')
  // Without the system keyring a run must not reach the desktop's own, which could ask the user to unlock it.
  const args = [MAIN_JS, '--ozone-platform=x11', '--force-device-scale-factor=1', '--disable-gpu', `--user-data-dir=${userData}`, ...(byAddress && options.keyring !== 'system' ? ['--password-store=basic'] : [])]
  ctx.launch = { executable, args, arg: options.arg, cwd: REPO, env, evidence, scratch, media, options, secondPid: join(scratch, 'second-pid') }
  const stopBrowsing = ctx.web === null ? () => {} : browseSignIns(ctx, signsInOnPage ? (url, n) => signInOnPage(ctx, url, n) : async url => ctx.web.tell(`browse ${url}`))
  let failed = null
  try {
    await launchApp(ctx)
    if (site) log(ctx, `serving ${options.serve} at ${site.origin} in place of ${DEV_ORIGIN}`)
    for (const { verb, args } of steps) {
      if (!STEPS[verb].logs) log(ctx, `${verb} ${args.map(arg => JSON.stringify(arg)).join(' ')}`)
      if (verb !== 'shot' && verb !== 'wait') ctx.holding = null
      await STEPS[verb].run(ctx, ...args)
      if (options.video) await ctx.page.waitForTimeout(VIDEO_HOLD_MS)
    }
    if (ctx.dialogs.length > 0) throw new Error(`the page opened ${ctx.dialogs.length} dialog(s): ${ctx.dialogs.join(', ')}`)
    if (ctx.signInFailures.length > 0) throw new Error(`a sign-in in the browser failed: ${ctx.signInFailures.join('; ')}`)
    for (const check of ctx.called) {
      const seen = callsLike(ctx, check)
      if (seen !== check.n) throw new Error(`by the end of the run the gateway saw ${seen} ${check.method} call(s) containing ${JSON.stringify(check.expected)}, not ${check.n}`)
    }
    for (const check of ctx.answered) {
      const seen = answersLike(ctx, check)
      if (seen !== check.n) throw new Error(`by the end of the run the gateway saw ${seen} answer(s) to a ${check.method} request containing ${JSON.stringify(check.expected)}, not ${check.n}`)
    }
    for (const { title, n } of ctx.notified) {
      const seen = noticesRecorded(ctx).filter(notice => notice.title === title).length
      if (seen !== n) throw new Error(`by the end of the run main recorded ${seen} notification(s) titled "${title}", not ${n}`)
    }
    if (ctx.browsed !== undefined && signInPages(ctx).length !== ctx.browsed) throw new Error(`by the end of the run main had opened the gateway's sign-in page ${signInPages(ctx).length} time(s), not ${ctx.browsed}`)
  } catch (error) {
    failed = error
    log(ctx, `FAILED: ${error.message.split('\n')[0]}`)
    if (ctx.page) await capture(ctx, join(evidence, 'failure.png')).catch(() => {})
  } finally {
    stopBrowsing()
    if (ctx.app) await quitApp(ctx)
    // Playwright writes the video when the app closes, so it covers the last launch of a run that restarts the app.
    const video = options.video ? ctx.page?.video() : null
    if (video) {
      const saved = await Promise.race([video.saveAs(join(evidence, 'video.webm')).then(() => true, () => false), new Promise(done => setTimeout(() => done(false), QUIT_MS))])
      log(ctx, saved ? `video saved as ${join(evidence, 'video.webm')}` : 'the video could not be saved')
      if (!saved && !failed) failed = new Error('--video was asked for and the video could not be saved')
    }
    site?.server.close()
    if (host) {
      const deadline = Date.now() + QUIT_MS
      while (toolsRunning(host.bin).length > 0 && Date.now() < deadline) await new Promise(done => setTimeout(done, 50))
      const left = toolsRunning(host.bin)
      if (left.length > 0 && !failed) {
        failed = new Error(`the app quit and left ${left.length} ssh, tailscale or hermes process(es) running: pid ${left.join(', ')}`)
        log(ctx, `FAILED: ${failed.message}`)
      }
      host.child.removeAllListeners('exit')
      host.child.kill()
      rmSync(join(scratch, 'host-pid'), { force: true })
    }
  }
  const tokens = ctx.web?.secrets ? await ctx.web.secrets() : []
  if (ctx.web?.child) {
    ctx.web.child.removeAllListeners('exit')
    ctx.web.child.kill()
    rmSync(join(scratch, 'host-pid'), { force: true })
  }
  if (ctx.realHost !== null) {
    for (const path of filesUnder(evidence).filter(file => !file.endsWith('.png'))) {
      const text = readFileSync(path, 'utf8')
      if (text.includes(ctx.realHost)) writeFileSync(path, aliased(ctx, text))
    }
  }
  const leaks = leaked(ctx, tokens)
  if (leaks.length > 0 && !failed) {
    failed = new Error(`a typed password, or a token the fake Webapp made, is in ${leaks.join(', ')}`)
    log(ctx, `FAILED: ${failed.message}`)
  }
  if (byAddress && !options.keyring && existsSync(join(userData, SIGN_INS_FILE)) && !failed) {
    failed = new Error(`the app wrote ${SIGN_INS_FILE} on a run with no keyring`)
    log(ctx, `FAILED: ${failed.message}`)
  }
  log(ctx, `${failed ? 'FAIL' : 'PASS'} evidence in ${evidence}${tokens.length > 0 ? `, and none of the fake Webapp's ${tokens.length} tokens, codes and tickets is written out in it or in the app's files` : ''}`)
  process.exit(failed ? 1 : 0)
}

const REFERENCES = {
  'tool-running': 'tool-running-C.png',
  approval: 'approval-C.png',
  settled: 'settled-C.png',
  'settled-expanded': 'settled-C-expanded.png',
  'bots-approved': 'bots-sidebar.png'
}

function compare(argv) {
  const [runId] = argv
  if (!runId) fail('compare <run>')
  const evidence = join(EVIDENCE_ROOT, runId)
  const shots = Object.keys(REFERENCES).filter(name => existsSync(join(evidence, `${name}.png`)))
  if (shots.length === 0) fail(`no shot in ${evidence} is named ${Object.keys(REFERENCES).join(', ')}`)
  for (const name of shots) {
    const out = join(evidence, `compare-${name}.png`)
    const result = spawnSync('magick', [join(REFERENCE, REFERENCES[name]), join(evidence, `${name}.png`), '+append', out], { stdio: 'inherit' })
    if (result.status !== 0) fail(`magick failed for ${name}`)
    console.log(out)
  }
}

function cleanup(argv) {
  const { options } = parseOptions(argv, { run: 'value', all: 'flag' })
  if (!options.run && !options.all) fail('cleanup --run <run> or cleanup --all')
  const targets = options.all ? (existsSync(SCRATCH_ROOT) ? readdirSync(SCRATCH_ROOT) : []) : [options.run]
  for (const runId of targets) {
    const scratch = join(SCRATCH_ROOT, runId)
    for (const pidFile of [join(scratch, 'pid'), join(scratch, 'host-pid'), join(scratch, 'second-pid'), join(scratch, 'browser-pid')]) {
      if (!existsSync(pidFile)) continue
      const pid = Number(readFileSync(pidFile, 'utf8'))
      if (alive(pid)) process.kill(pid, 'SIGKILL')
      console.log(`stopped ${runId} pid ${pid}`)
    }
    if (!resolve(scratch).startsWith(`${SCRATCH_ROOT}/`)) fail(`refusing to remove ${scratch}`)
    rmSync(scratch, { recursive: true, force: true })
    console.log(`removed ${scratch}`)
  }
}

function underXvfb(argv) {
  const firstDisplay = String(100 + (process.pid % 800))
  const child = spawn('xvfb-run', ['-n', firstDisplay, '-a', '-s', '-screen 0 1600x1200x24', process.execPath, fileURLToPath(import.meta.url), ...argv], {
    stdio: 'inherit', env: { ...process.env, HIGHWING_VERIFY_XVFB: '1' }
  })
  child.on('exit', code => process.exit(code ?? 1))
}

const [command, ...argv] = process.argv.slice(2)
const COMMANDS = {
  doctor,
  build,
  run: () => (process.env.HIGHWING_VERIFY_XVFB === '1' ? run(argv) : underXvfb(['run', ...argv])),
  compare: () => compare(argv),
  cleanup: () => cleanup(argv)
}
;(COMMANDS[command] ?? (() => fail(`usage: highwing-verify.mjs <${Object.keys(COMMANDS).join('|')}> ...`)))()
