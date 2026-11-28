import { mkdtempSync, readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
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
    expect(await saver.save('hermes_session_s1.md', to => writeFile(to, '# Notes'))).toBe(join(dir, 'mine.md'))
    expect(asked).toEqual([{ defaultPath: '/home/u/Downloads/hermes_session_s1.md' }])
    expect(readFileSync(join(dir, 'mine.md'), 'utf8')).toBe('# Notes')
  })

  it('writes nothing when the user cancels', async () => {
    const saver = dialogSaver({ showSaveDialog: async () => ({ canceled: true, filePath: '' }) } as never, () => '/home/u/Downloads')
    const written: string[] = []
    expect(await saver.save('chat.md', async to => void written.push(to))).toBeNull()
    expect(written).toEqual([])
  })
})

describe('folderSaver', () => {
  it('keeps the suggested name to one file in its folder', async () => {
    const dir = scratch()
    const path = await folderSaver(dir).save('../../etc/chat.json', to => writeFile(to, '{}'))
    expect(path).toBe(join(dir, 'chat.json'))
    expect(readFileSync(path!, 'utf8')).toBe('{}')
  })

  it('names a file from a Windows path by its own name', async () => {
    const dir = scratch()
    expect(await folderSaver(dir).save('C:\\Users\\rae\\notes.md', to => writeFile(to, '# Notes'))).toBe(join(dir, 'notes.md'))
  })

  it("rejects when the file can't be written", async () => {
    await expect(folderSaver(scratch()).save('notes.md', async () => { throw new Error('EACCES') })).rejects.toThrow('EACCES')
  })
})
