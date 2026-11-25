import { resolveObjectURL } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { blobUrlOf } from '../src/renderer/bots/pictures'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

describe('blobUrlOf', () => {
  it("holds Hermes's picture as a blob of the same bytes and type, since the page loads images only from blob URLs", async () => {
    const url = blobUrlOf(`data:image/png;base64,${PNG.toString('base64')}`)
    expect(url).toMatch(/^blob:/)
    const blob = resolveObjectURL(url!)
    expect(blob?.type).toBe('image/png')
    expect(Buffer.from(await blob!.arrayBuffer())).toEqual(PNG)
  })

  it('makes nothing of a data URL that is no picture, or is not base64', () => {
    expect(blobUrlOf('data:text/html;base64,PGI+aGk8L2I+')).toBeNull()
    expect(blobUrlOf('data:image/svg+xml;base64,PHN2Zz4=')).toBeNull()
    expect(blobUrlOf('data:image/png;base64,***')).toBeNull()
  })
})
