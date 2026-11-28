import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const html = readFileSync('apps/desktop/src/renderer/index.html', 'utf8')
const policy = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(html)?.[1] ?? ''
const directives = new Map(policy.split(';').map(part => part.trim()).filter(Boolean).map(part => {
  const [name = '', ...sources] = part.split(/\s+/)
  return [name, sources] as const
}))

const LOGOS = 'https://logos.composio.dev'

const REMOTE = /^(?:https?:|\*|[a-z][a-z0-9+.-]*:\/\/|(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?(?:\/.*)?$)/i

describe('the renderer Content Security Policy', () => {
  it('is in index.html', () => {
    expect(directives.size).toBeGreaterThan(0)
  })

  it('names no remote source in any directive but the connector logo host', () => {
    for (const [name, sources] of directives) {
      for (const source of sources) expect(REMOTE.test(source) && !(name === 'img-src' && source === LOGOS), `${name} ${source}`).toBe(false)
    }
  })

  it('lets images come from the app, from blob urls and from the connector logo host, and nowhere else', () => {
    expect(directives.get('img-src')).toEqual(["'self'", 'blob:', LOGOS])
  })
})
