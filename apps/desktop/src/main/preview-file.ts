import { open } from 'node:fs/promises'
import { basename } from 'node:path'
import { buffer } from 'node:stream/consumers'
import type { Table } from '../ipc-contract'

export const MISSING = "This file isn't there any more."

const MB = 1024 * 1024
const QUOTE = 0x22
const LF = 0x0a
const CR = 0x0d
const DELIMITERS = [',', ';', '\t']
const FIRST_RECORD = /^(?:"[^"]*"|[^"\r\n])*/
const QUOTED = /"[^"]*"/g

type Read<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string }
const failed = (reason: string) => ({ ok: false, reason }) as const

export interface FileContents { readonly pdf: Uint8Array<ArrayBuffer>; readonly csv: Table }
export type Format = keyof FileContents

interface Spec<T> {
  readonly name: RegExp
  readonly noun: string
  readonly limit: number
  take(bytes: Buffer<ArrayBuffer>): Read<T>
}

const FORMATS: { readonly [F in Format]: Spec<FileContents[F]> } = {
  pdf: {
    name: /\.pdf$/i,
    noun: 'a PDF',
    limit: 50 * MB,
    take: bytes => (bytes.subarray(0, 1024).includes('%PDF-') ? { ok: true, value: bytes } : failed("This isn't a PDF."))
  },
  csv: {
    name: /\.(csv|tsv)$/i,
    noun: 'a CSV',
    limit: 10 * MB,
    take: bytes => {
      try {
        return { ok: true, value: tableOf(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
      } catch {
        return failed("This file isn't UTF-8 text.")
      }
    }
  }
}

export const formatOf = (path: string): Format | null => (Object.keys(FORMATS) as Format[]).find(format => FORMATS[format].name.test(path)) ?? null

const sizeOf = (bytes: number) => `${Math.ceil((bytes / MB) * 10) / 10} MB`

/**
 * The file as the pane shows it, checked by its bytes as well as its name. The size the first look
 * gives settles the limit, and the read stops one byte past it, as the file may grow in between.
 */
export async function readPreviewFile<F extends Format>(path: string, format: F): Promise<Read<FileContents[F]>> {
  const { noun, limit, take } = FORMATS[format] as Spec<FileContents[F]>
  const tooBig = (size: number) => failed(`${basename(path)} is ${sizeOf(size)}. Highwing previews ${noun} up to ${sizeOf(limit)}.`)
  let handle
  try {
    handle = await open(path)
    const { size } = await handle.stat()
    if (size > limit) return tooBig(size)
    const bytes = await buffer(handle.createReadStream({ start: 0, end: limit, autoClose: false }))
    return bytes.length > limit ? tooBig(bytes.length) : take(bytes)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return failed(code === 'ENOENT' || code === 'ENOTDIR' ? MISSING : "Highwing couldn't read this file.")
  } finally {
    await handle?.close()
  }
}

function delimiterOf(text: string): number {
  const bare = (FIRST_RECORD.exec(text)?.[0] ?? '').replace(QUOTED, '')
  const counts = DELIMITERS.map(delimiter => bare.split(delimiter).length - 1)
  return (DELIMITERS[counts.indexOf(Math.max(...counts))] ?? ',').charCodeAt(0)
}

export function parseCsv(text: string, kept = Infinity): { readonly records: string[][]; readonly total: number } {
  const delimiter = delimiterOf(text)
  const records: string[][] = []
  let total = 0
  const keep = (done: string[]) => {
    if (records.length < kept) records.push(done)
    total++
  }
  let record: string[] = []
  let field = ''
  let run = 0
  let fresh = true
  let started = false
  let at = 0
  const endField = () => {
    record.push(field + text.slice(run, at))
    field = ''
  }
  while (at < text.length) {
    const char = text.charCodeAt(at)
    if (char === QUOTE && fresh) {
      let from = at + 1
      for (;;) {
        const quote = text.indexOf('"', from)
        if (quote === -1) {
          field += text.slice(from)
          from = text.length
          break
        }
        field += text.slice(from, quote)
        if (text.charCodeAt(quote + 1) !== QUOTE) {
          from = quote + 1
          break
        }
        field += '"'
        from = quote + 2
      }
      at = run = from
      fresh = false
      started = true
    } else if (char === delimiter) {
      endField()
      run = ++at
      fresh = started = true
    } else if (char === LF || char === CR) {
      endField()
      keep(record)
      record = []
      at += char === CR && text.charCodeAt(at + 1) === LF ? 2 : 1
      run = at
      fresh = true
      started = false
    } else {
      at++
      fresh = false
      started = true
    }
  }
  if (started) {
    endField()
    keep(record)
  }
  return { records, total }
}

export function tableOf(text: string, cut = 5000): Table {
  const { records: [header = [], ...rows], total } = parseCsv(text, cut + 1)
  return { header, rows, total: Math.max(total - 1, 0) }
}
