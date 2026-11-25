import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { dialogSaver, folderSaver } from '../src/main/saves'

const scratch = () => mkdtempSync(join(tmpdir(), 'highwing-saves-'))

describe('dialogSaver', () => {
  it('offers the suggested name in the folder, and writes where the user chose', async () => {
    const dir = scratch()
    const asked: unknown[] = []
    const saver = dialogSaver({ showSaveDialog: async (options: unknown) => (asked.push(options), { canceled: false, filePath: join(dir, 'mine.md') }) } as never, () => '/home/u/Downloads')
    expect(await saver.save({ filename: 'hermes_session_s1.md', content: '# Notes' })).toBe(join(dir, 'mine.md'))
    expect(asked).toEqual([{ defaultPath: '/home/u/Downloads/hermes_session_s1.md' }])
    expect(readFileSync(join(dir, 'mine.md'), 'utf8')).toBe('# Notes')
  })

  it('writes nothing when the user cancels', async () => {
    const saver = dialogSaver({ showSaveDialog: async () => ({ canceled: true, filePath: '' }) } as never, () => '/home/u/Downloads')
    expect(await saver.save({ filename: 'chat.md', content: '# Notes' })).toBeNull()
  })
})

describe('folderSaver', () => {
  it('keeps the suggested name to one file in its folder', async () => {
    const dir = scratch()
    const path = await folderSaver(dir).save({ filename: '../../etc/chat.json', content: '{}' })
    expect(path).toBe(join(dir, 'chat.json'))
    expect(readFileSync(path!, 'utf8')).toBe('{}')
  })
})
