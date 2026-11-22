/** One run inside a block. `br` is a line break and holds `\n`. Nothing here is HTML. */
export interface ProseRun { readonly t: 'text' | 'code' | 'bold' | 'br'; readonly v: string }

/** A paragraph, or a fenced code block, which is one `text` run. */
export interface ProseBlock { readonly code: boolean; readonly pieces: readonly ProseRun[] }

const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|\n)/

function inline(paragraph: string): ProseRun[] {
  return paragraph.split(INLINE).filter(Boolean).map((part): ProseRun => {
    if (part === '\n') return { t: 'br', v: part }
    if (part.startsWith('`')) return { t: 'code', v: part.slice(1, -1) }
    if (part.startsWith('**')) return { t: 'bold', v: part.slice(2, -2) }
    return { t: 'text', v: part }
  })
}

export function proseBlocks(markdown: string): readonly ProseBlock[] {
  return markdown.split(/```[\w-]*\n?/).flatMap((chunk, index): ProseBlock[] => index % 2 === 1
    ? [{ code: true, pieces: [{ t: 'text', v: chunk.replace(/\n$/, '') }] }]
    : chunk.split(/\n{2,}/).filter(block => block.trim() !== '').map(block => ({ code: false, pieces: inline(block) })))
}

/** The text a block puts on screen, which is what find searches. */
export const proseText = (block: ProseBlock) => block.pieces.map(piece => piece.v).join('')
