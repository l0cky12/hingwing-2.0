import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Session, SshHost, Target } from '@highwing/hermes/domain'
import { describe, expect, it } from 'vitest'
import type { Setup } from '../src/ipc-contract'
import { failureOf, nextPane, pageFor, pageInView, pageUrlOf, pathOfPageUrl, previewOf, reachable, reachOf, servedPath, type Pane, type PaneEvent } from '../src/main/preview-page'

const SITE = '/tmp/hermes-proto-work/site/index.html'
const wrote = (path: string) => ({
  cwd: '/tmp/hermes-proto-work',
  history: [{ items: [{ kind: 'tool', status: { s: 'done', diffs: [{ path }] } }] }],
  run: { state: 'idle' }
}) as unknown as Session

const local = { session: wrote(SITE), local: true, machine: 'this computer' }
const remote = { session: wrote(SITE), local: false, machine: 'hermes-host' }

describe('pageFor', () => {
  it.each(['http://localhost:5173/', 'https://example.com/docs?page=2', 'http://127.0.0.1:8000/'])('loads the web page %s from a local Hermes', url => {
    expect(pageFor(url, local)).toEqual({ address: url, page: { kind: 'web', url } })
  })

  it.each(['http://localhost:5173/', 'http://127.0.0.1:8000/', 'http://[::1]:3000/', 'http://0.0.0.0:4000/', 'http://app.localhost/'])(
    "says a remote Hermes's loopback page %s is out of reach",
    url => {
      expect(pageFor(url, remote)).toEqual({ address: url, failed: "This page runs on hermes-host. Highwing can't reach that machine's localhost." })
    }
  )

  it('loads a page on another host from a remote Hermes', () => {
    expect(pageFor('https://example.com/', remote)).toEqual({ address: 'https://example.com/', page: { kind: 'web', url: 'https://example.com/' } })
  })

  it('loads a file a finished step named, as a path or a file url, from a local Hermes', () => {
    expect(pageFor(SITE, local)).toEqual({ address: SITE, page: { kind: 'file', path: SITE } })
    expect(pageFor(`file://${SITE}`, local)).toEqual({ address: SITE, page: { kind: 'file', path: SITE } })
    expect(pageFor('site/index.html', { ...local, session: wrote('site/index.html') })).toEqual({ address: SITE, page: { kind: 'file', path: SITE } })
  })

  it("says a remote Hermes's file is on that machine", () => {
    expect(pageFor(SITE, remote)).toEqual({ address: SITE, failed: 'This file is on hermes-host.' })
  })

  it.each([
    ['a path no step named', '/etc/passwd'],
    ['a file url no step named', 'file:///etc/passwd'],
    ['a file url on another host', `file://server${SITE}`],
    ['a script', 'javascript:alert(1)'],
    ['a mail link', 'mailto:someone@example.com'],
    ['inline data', 'data:text/html,<h1>hi</h1>'],
    ['a bare host', 'localhost:5173']
  ])('refuses %s', (_, request) => {
    expect(pageFor(request, local)).toBeNull()
  })

  it('refuses a path when no chat named it', () => {
    expect(pageFor(SITE, { ...local, session: undefined })).toBeNull()
  })
})

describe('reachOf', () => {
  it('reads a fixture run and a local connection as this computer, and a remote one as its machine', () => {
    const live = (target: Target): Setup => ({ at: 'chat', live: { target, epoch: 1 } })
    expect(reachOf({ at: 'pinned' }, undefined)).toEqual({ session: undefined, local: true, machine: 'this computer' })
    expect(reachOf(live({ kind: 'local' }), undefined)).toMatchObject({ local: true, machine: 'this computer' })
    expect(reachOf(live({ kind: 'remote', host: 'hermes-host.example-tailnet.ts.net' as SshHost }), undefined)).toMatchObject({ local: false, machine: 'hermes-host' })
  })
})

describe('failureOf', () => {
  it('names the host it could not find or reach, and passes on any other error as Chromium words it', () => {
    expect(failureOf(-105, 'ERR_NAME_NOT_RESOLVED', 'http://unreachable.invalid/')).toBe("Highwing couldn't find unreachable.invalid.")
    expect(failureOf(-102, 'ERR_CONNECTION_REFUSED', 'http://127.0.0.1:5173/')).toBe('Nothing answered at 127.0.0.1:5173.')
    expect(failureOf(-201, 'ERR_CERT_DATE_INVALID', 'https://expired.example/')).toBe("This page didn't load (ERR_CERT_DATE_INVALID).")
  })
})

describe('the pane', () => {
  const run = (...events: PaneEvent[]) => events.reduce<Pane | null>(nextPane, null)
  const show = (label: string | null = null, address = 'http://localhost:5173/'): PaneEvent => ({ on: 'show', asked: address, address, label, load: { at: 'loading' } })

  it("is titled by Hermes's label, else by the page's own title, else by its address", () => {
    expect(previewOf(run(show('demo'), { on: 'titled', title: 'Vite App' }))).toMatchObject({ state: 'open', title: 'demo' })
    expect(previewOf(run(show(), { on: 'titled', title: 'Vite App' }))).toMatchObject({ title: 'Vite App' })
    expect(previewOf(run(show(), { on: 'titled', title: '  ' }))).toMatchObject({ title: 'http://localhost:5173/' })
  })

  it('draws the page once it has loaded, and keeps it in view while it reloads', () => {
    const loading = run(show())
    expect(previewOf(loading)).toEqual({ state: 'open', title: 'http://localhost:5173/', address: 'http://localhost:5173/', content: { kind: 'page', load: { at: 'loading' } } })
    expect(pageInView(loading)).toBe(false)
    const shown = nextPane(loading, { on: 'loaded' })
    expect(previewOf(shown)).toMatchObject({ content: { load: { at: 'shown' } } })
    expect(pageInView(nextPane(shown, { on: 'loading' }))).toBe(true)
  })

  it('gives a failed page its reason in place of the page, until the next load starts', () => {
    const failed = run(show(), { on: 'loaded' }, { on: 'failed', reason: 'This page stopped working. Reload to try again.' }, { on: 'loaded' })
    expect(previewOf(failed)).toMatchObject({ content: { load: { at: 'failed', reason: 'This page stopped working. Reload to try again.' } } })
    expect(pageInView(failed)).toBe(false)
    expect(previewOf(run(show(), { on: 'failed', reason: 'x' }, { on: 'loading' }, { on: 'loaded' }))).toMatchObject({ content: { load: { at: 'shown' } } })
  })

  it('follows the page to where it navigated, and keeps what was asked for', () => {
    const moved = run(show(), { on: 'navigated', address: 'http://localhost:5173/about' })
    expect(moved).toMatchObject({ asked: 'http://localhost:5173/', address: 'http://localhost:5173/about' })
    expect(previewOf(moved)).toMatchObject({ address: 'http://localhost:5173/about' })
  })

  it('closes, and stays closed whatever a closing page still reports', () => {
    expect(previewOf(run(show(), { on: 'close' }, { on: 'loaded' }, { on: 'titled', title: 'late' }))).toEqual({ state: 'closed' })
  })

  it('starts a new page with nothing of the last one', () => {
    expect(previewOf(run(show('demo'), { on: 'loaded' }, show(null, 'https://example.com/'))))
      .toEqual({ state: 'open', title: 'https://example.com/', address: 'https://example.com/', content: { kind: 'page', load: { at: 'loading' } } })
  })
})

describe('a file page', () => {
  const HOME = '/home/someone'
  const PAGE = '/home/someone/work/site/index.html'

  it('loads from the page scheme and reads back as the same path', () => {
    expect(pageUrlOf('/tmp/my site/index.html')).toBe('highwing-page://file/tmp/my%20site/index.html')
    expect(pathOfPageUrl(pageUrlOf('/tmp/my site/index.html'))).toBe('/tmp/my site/index.html')
    expect(pathOfPageUrl('file:///tmp/site/index.html')).toBeNull()
  })

  it.each(['/home/someone/work/site/index.html', '/home/someone/work/site/style.css', '/home/someone/work/site/img/logo.png'])('reaches %s', path => {
    expect(reachable(PAGE, path, HOME)).toBe(true)
  })

  it.each(['/home/someone/.ssh/id_ed25519', '/etc/passwd', '/home/someone/work/notes.md', '/home/someone/work/site/.env', '/home/someone/work/site/.git/config'])(
    'never reaches %s',
    path => expect(reachable(PAGE, path, HOME)).toBe(false)
  )

  it('reaches only itself from the home folder or above it', () => {
    expect(reachable('/home/someone/report.html', '/home/someone/report.html', HOME)).toBe(true)
    expect(reachable('/home/someone/report.html', '/home/someone/work/site/style.css', HOME)).toBe(false)
    expect(reachable('/home/index.html', '/home/someone/work/a.css', HOME)).toBe(false)
  })
})

describe('the page scheme', () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'preview-home-')))
  const site = join(home, 'work/site')
  mkdirSync(site, { recursive: true })
  const page = join(site, 'index.html')
  writeFileSync(page, '<h1>page</h1>')
  writeFileSync(join(site, 'style.css'), 'h1 {}')
  writeFileSync(join(home, 'secret.txt'), 'secret')
  symlinkSync(join(home, 'secret.txt'), join(site, 'notes.txt'))
  symlinkSync(join(site, 'style.css'), join(site, 'theme.css'))

  it('serves the page and a file beside it', async () => {
    expect(await servedPath(page, page, home)).toBe(page)
    expect(await servedPath(page, join(site, 'style.css'), home)).toBe(join(site, 'style.css'))
  })

  it('serves a link inside the folder only where it really points inside the folder', async () => {
    expect(await servedPath(page, join(site, 'theme.css'), home)).toBe(join(site, 'style.css'))
    expect(await servedPath(page, join(site, 'notes.txt'), home)).toBeNull()
  })

  it('serves nothing that is not there', async () => {
    expect(await servedPath(page, join(site, 'gone.css'), home)).toBeNull()
  })
})
