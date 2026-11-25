import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { formatOf, parseCsv, readPreviewFile, tableOf } from '../src/main/preview-file'

const QUOTED = join(import.meta.dirname, '../../../fixtures/preview-files/quoted.csv')

describe('parseCsv', () => {
  it('keeps a quoted comma, a quoted newline and a doubled quote each in one cell', () => {
    expect(parseCsv(readFileSync(QUOTED, 'utf8')).records).toEqual([
      ['name', 'note', 'total'],
      ['Smith, Alice', 'Paid in two parts:\nfirst in October', '120'],
      ['Bob', 'Said "thanks"', '98']
    ])
  })

  it.each([
    ['semicolons', 'a;b\n1,5;2\n', [['a', 'b'], ['1,5', '2']]],
    ['tabs', 'a\tb\n"x\ty"\t2', [['a', 'b'], ['x\ty', '2']]],
    ['a comma on a tie', 'a,b;c\n1,2;3', [['a', 'b;c'], ['1', '2;3']]],
    ['a comma when the first record has none', 'a\n1;2', [['a'], ['1;2']]],
    ['a delimiter in a quoted header', '"a;b",c\n1,2', [['a;b', 'c'], ['1', '2']]]
  ])('splits on %s', (_, text, records) => {
    expect(parseCsv(text).records).toEqual(records)
  })

  it('reads CRLF and LF line ends, and makes no record of a final line end', () => {
    expect(parseCsv('a,b\r\n1,2\r\n').records).toEqual([['a', 'b'], ['1', '2']])
    expect(parseCsv('a,b\n1,2\n').records).toEqual([['a', 'b'], ['1', '2']])
    expect(parseCsv('a,"b\r\nc"\r\n').records).toEqual([['a', 'b\r\nc']])
  })

  it('keeps empty fields and a blank line inside the file', () => {
    expect(parseCsv('a,,\n\n,"",x').records).toEqual([['a', '', ''], [''], ['', '', 'x']])
    expect(parseCsv('').records).toEqual([])
  })

  it('keeps only the records asked for, and counts them all', () => {
    expect(parseCsv('a\nb\nc\n', 2)).toEqual({ records: [['a'], ['b']], total: 3 })
  })
})

describe('tableOf', () => {
  it('takes the first record as the header, cuts the rows at 5,000, and counts them all', () => {
    const table = tableOf(['n', ...Array.from({ length: 20_000 }, (_, row) => `${row}`)].join('\n'))
    expect(table.header).toEqual(['n'])
    expect(table.rows).toHaveLength(5000)
    expect(table.rows.at(-1)).toEqual(['4999'])
    expect(table.total).toBe(20_000)
  })

  it('reads an empty file as no header and no rows', () => {
    expect(tableOf('')).toEqual({ header: [], rows: [], total: 0 })
  })
})

describe('formatOf', () => {
  it.each([
    ['/w/report.pdf', 'pdf'], ['/w/REPORT.PDF', 'pdf'], ['/w/report.csv', 'csv'], ['/w/data.tsv', 'csv'], ['/w/site/index.html', null], ['/w/pdf', null]
  ])('reads %s as %s', (path, format) => {
    expect(formatOf(path)).toBe(format)
  })
})

describe('readPreviewFile', () => {
  const dir = mkdtempSync(join(tmpdir(), 'preview-file-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  const file = (name: string, bytes: string | Uint8Array) => {
    const path = join(dir, name)
    writeFileSync(path, bytes)
    return path
  }

  it('reads a CSV into a table, without its byte order mark', async () => {
    await expect(readPreviewFile(file('bom.csv', '﻿name,total\nAlice,120\n'), 'csv')).resolves.toEqual({
      ok: true,
      value: { header: ['name', 'total'], rows: [['Alice', '120']], total: 1 }
    })
  })

  it('says a CSV that is not UTF-8 is not UTF-8', async () => {
    await expect(readPreviewFile(file('latin1.csv', Uint8Array.from([0x6e, 0x61, 0x6d, 0x65, 0x0a, 0xe9, 0x74, 0xe9])), 'csv'))
      .resolves.toEqual({ ok: false, reason: "This file isn't UTF-8 text." })
  })

  it('reads a PDF as its bytes, and says a file named .pdf without them is not a PDF', async () => {
    const pdf = `${' '.repeat(16)}%PDF-1.7\n%%EOF\n`
    const read = await readPreviewFile(file('report.pdf', pdf), 'pdf')
    expect(read.ok && Buffer.from(read.value).toString()).toBe(pdf)
    await expect(readPreviewFile(file('fake.pdf', '<html>not a pdf</html>'), 'pdf')).resolves.toEqual({ ok: false, reason: "This isn't a PDF." })
    await expect(readPreviewFile(file('late.pdf', `${' '.repeat(1024)}%PDF-1.7`), 'pdf')).resolves.toEqual({ ok: false, reason: "This isn't a PDF." })
  })

  it('refuses a file over the limit, naming its size and the limit', async () => {
    const csv = file('report.csv', 'a\n')
    execFileSync('truncate', ['-s', `${Math.round(12.4 * 1024 * 1024)}`, csv])
    await expect(readPreviewFile(csv, 'csv')).resolves.toEqual({ ok: false, reason: 'report.csv is 12.4 MB. Highwing previews a CSV up to 10 MB.' })
    const pdf = file('big.pdf', '%PDF-1.7\n')
    execFileSync('truncate', ['-s', `${50 * 1024 * 1024 + 1}`, pdf])
    await expect(readPreviewFile(pdf, 'pdf')).resolves.toEqual({ ok: false, reason: 'big.pdf is 50.1 MB. Highwing previews a PDF up to 50 MB.' })
  })

  it('says a file that is gone is not there any more', async () => {
    await expect(readPreviewFile(join(dir, 'gone.csv'), 'csv')).resolves.toEqual({ ok: false, reason: "This file isn't there any more." })
    await expect(readPreviewFile(join(dir, 'bom.csv', 'inside.csv'), 'csv')).resolves.toEqual({ ok: false, reason: "This file isn't there any more." })
  })
})
