/**
 * Runs the fake Hermes Webapp for a verify run: `tsx scripts/fake-webapp.ts <scenario> <fixture> [<username file> <password file>]`.
 * It prints one JSON line naming the gateway's address, then serves until it is killed. The gateway
 * behind it plays `fixture` at its recorded pace. It reads commands from stdin, one per line:
 * - `browse <url>`: the scenario's user opens that page, as the fake's `browse` does;
 * - `sign-out`: Hermes ends every sign-in;
 * - `secrets`: prints one JSON line with every token, code and ticket the fake has made.
 * With the two files, `/login` serves the form of Hermes's own page and signs in only that user.
 */
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createInterface } from 'node:readline'
import { fakeWebapp, WEBAPP_SCENARIOS, type WebappScenarioName } from '../packages/hermes/src/testing/fake-webapp'
import { loadFixture } from '../packages/hermes/src/testing/fixture'
import { RING_FRAMES, ScriptedGateway } from '../packages/hermes/src/testing/gateway'
import { loopback, type Front, type Loopback } from '../packages/hermes/src/testing/loopback'
import { systemClock } from '../packages/hermes/src/wire/link'

const [scenario, fixture, usernameFile, passwordFile] = process.argv.slice(2)
if (scenario === undefined || !Object.hasOwn(WEBAPP_SCENARIOS, scenario) || fixture === undefined || (usernameFile === undefined) !== (passwordFile === undefined)) {
  console.error(`usage: fake-webapp.ts <${Object.keys(WEBAPP_SCENARIOS).join('|')}> <fixture> [<username file> <password file>]`)
  process.exit(2)
}

/** The fields and the wiring of Hermes's page (hermes_cli/dashboard_auth/login_page.py:618-651 and :469-514), without its styling. */
const LOGIN_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Sign in — Hermes Agent</title></head>
<body><main>
  <h1>Sign in</h1>
  <form class="provider-form" data-provider="basic" autocomplete="on">
    <input type="hidden" name="next" value="">
    <label class="field"><span class="field-label">Username</span><input class="field-input" type="text" name="username" required></label>
    <label class="field"><span class="field-label">Password</span><input class="field-input" type="password" name="password" required></label>
    <div class="form-error" role="alert" hidden></div>
    <button class="provider-btn" type="submit">Sign in</button>
  </form>
</main>
<script>
document.querySelector('form.provider-form').addEventListener('submit', async event => {
  event.preventDefault()
  const form = event.currentTarget
  const field = name => form.querySelector('input[name=' + name + ']').value
  const reply = await fetch('/auth/password-login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
    body: JSON.stringify({ provider: form.dataset.provider, username: field('username'), password: field('password'), next: field('next') })
  })
  if (reply.ok) return window.location.assign((await reply.json()).next)
  const error = form.querySelector('.form-error')
  error.textContent = reply.status === 401 ? 'Invalid username or password.' : 'Sign-in failed. Please try again.'
  error.hidden = false
})
</script></body></html>
`

async function jsonOf(request: IncomingMessage): Promise<Readonly<Record<string, unknown>>> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  try {
    return JSON.parse(Buffer.concat(chunks).toString()) as Readonly<Record<string, unknown>>
  } catch {
    return {}
  }
}

/**
 * The gateway with Hermes's password form in front of the fake's `/login`, which signs in whoever
 * asks. The form's post reaches that `/login` only with the right username and password, and
 * answers with where it sent the browser, as `/auth/password-login` does (hermes_cli/dashboard_auth/routes.py:466).
 */
function behindLoginForm(gateway: Loopback, user: { readonly username: string; readonly password: string }): Loopback {
  const passed = randomBytes(16).toString('hex')
  const serve = (webapp: Front) => async (request: IncomingMessage, response: ServerResponse) => {
    const { pathname, searchParams } = new URL(request.url ?? '/', 'http://fake-webapp')
    if (request.method === 'GET' && pathname === '/login' && request.headers['x-fake-signed-in'] !== passed) {
      const pending = `fake_pending=${encodeURIComponent(searchParams.get('broker') ?? '')}; HttpOnly; Path=/; SameSite=Lax`
      return void response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'set-cookie': pending }).end(LOGIN_PAGE)
    }
    if (request.method !== 'POST' || pathname !== '/auth/password-login') return webapp.serve(request, response)
    const body = await jsonOf(request)
    const broker = /(?:^|; )fake_pending=([^;]*)/.exec(request.headers.cookie ?? '')?.[1] ?? ''
    const answer = (status: number, json: unknown) => void response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(json))
    if (body.username !== user.username || body.password !== user.password) return answer(401, { detail: 'Invalid credentials' })
    const sent = await fetch(`http://127.0.0.1:${gateway.port}/login?broker=${broker}`, { redirect: 'manual', headers: { 'x-fake-signed-in': passed } })
    const next = sent.headers.get('location')
    return next === null ? answer(400, { detail: 'This sign-in has expired.' }) : answer(200, { ok: true, next })
  }
  return { ...gateway, front: webapp => gateway.front({ ...webapp, serve: (request, response) => void serve(webapp)(request, response) }) }
}

const oneLine = (file: string) => readFileSync(file, 'utf8').replace(/\r?\n$/, '')

const gateway = await loopback(new ScriptedGateway(loadFixture(fixture), { clock: systemClock, timing: 'recorded', ringFrames: RING_FRAMES, drop: null }), systemClock)
const web = await fakeWebapp(
  scenario as WebappScenarioName,
  usernameFile === undefined || passwordFile === undefined ? gateway : behindLoginForm(gateway, { username: oneLine(usernameFile), password: oneLine(passwordFile) }),
  systemClock
)
console.log(JSON.stringify({ url: web.url }))

const COMMANDS: Readonly<Record<string, (rest: string) => unknown>> = {
  browse: url => web.browse(url),
  'sign-out': () => web.signOut(),
  secrets: () => console.log(JSON.stringify({ secrets: web.secrets }))
}

for await (const line of createInterface({ input: process.stdin })) {
  const [command = '', rest = ''] = line.split(/ (.*)/s)
  await COMMANDS[command]?.(rest)
}
