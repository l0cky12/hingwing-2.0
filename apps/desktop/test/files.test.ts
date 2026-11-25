import type { Session } from '@highwing/hermes/domain'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { desktopOpener, openablePath } from '../src/main/files'

const edited = (path: string, cwd: string | null) => ({
  cwd,
  history: [{ items: [{ kind: 'tool', status: { s: 'done', diffs: [{ path }] } }] }],
  run: { state: 'idle' }
}) as unknown as Session

describe('openablePath', () => {
  it('normalizes an absolute path that a step named', () => {
    expect(openablePath(edited('/work/./notes.md', null), '/work/./notes.md')).toBe('/work/notes.md')
  })

  it('resolves a relative path against the working folder', () => {
    expect(openablePath(edited('notes.md', '/work'), 'notes.md')).toBe('/work/notes.md')
  })

  it.each([['no working folder', null], ['a relative working folder', 'work']])('refuses a relative path with %s', (_, cwd) => {
    expect(openablePath(edited('notes.md', cwd), 'notes.md')).toBeNull()
  })

  it('refuses a step that has not finished and a path no step named', () => {
    const running = { cwd: null, history: [], run: { state: 'running', turn: { items: [{ kind: 'tool', status: { s: 'running', note: null } }] } } } as unknown as Session
    expect(openablePath(running, '/work/notes.md')).toBeNull()
    expect(openablePath(edited('/work/notes.md', null), '/work/other.md')).toBeNull()
  })

  it('refuses a url even when a step named it', () => {
    expect(openablePath(edited('file:///work/notes.md', null), 'file:///work/notes.md')).toBeNull()
  })
})

describe('desktopOpener', () => {
  let folder = ''
  beforeAll(async () => {
    folder = await mkdtemp(join(tmpdir(), 'highwing-files-'))
    await writeFile(join(folder, 'notes.md'), '# Notes\n')
  })
  afterAll(() => rm(folder, { recursive: true, force: true }))

  const shell = (opened = '') => ({
    openPath: vi.fn<(path: string) => Promise<string>>(async () => opened),
    showItemInFolder: vi.fn<(path: string) => void>(),
    openExternal: vi.fn<(url: string) => Promise<void>>(async () => {})
  })

  it('reports a missing file and never calls the desktop', async () => {
    const fake = shell()
    const opener = desktopOpener(fake)
    await expect(opener.open(join(folder, 'gone.md'))).resolves.toEqual({ ok: false, reason: 'missing' })
    await expect(opener.show(join(folder, 'gone.md'))).resolves.toEqual({ ok: false, reason: 'missing' })
    expect(fake.openPath).not.toHaveBeenCalled()
    expect(fake.showItemInFolder).not.toHaveBeenCalled()
  })

  it('opens an existing file once', async () => {
    const fake = shell()
    await expect(desktopOpener(fake).open(join(folder, 'notes.md'))).resolves.toEqual({ ok: true })
    expect(fake.openPath.mock.calls).toEqual([[join(folder, 'notes.md')]])
  })

  it('shows an existing file in its folder', async () => {
    const fake = shell()
    await expect(desktopOpener(fake).show(join(folder, 'notes.md'))).resolves.toEqual({ ok: true })
    expect(fake.showItemInFolder.mock.calls).toEqual([[join(folder, 'notes.md')]])
  })

  it('reports failed when the desktop returns an error', async () => {
    await expect(desktopOpener(shell('No application is registered')).open(join(folder, 'notes.md'))).resolves.toEqual({ ok: false, reason: 'failed' })
  })
})
