export type ProseRun = { readonly t: 'text' | 'code' | 'bold'; readonly v: string } | { readonly t: 'br' }

export type ProseBlock = { readonly code: true; readonly text: string } | { readonly code: false; readonly runs: readonly ProseRun[] }

const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|\n)/

function inline(paragraph: string): ProseRun[] {
  return paragraph.split(INLINE).filter(Boolean).map((part): ProseRun => {
    if (part === '\n') return { t: 'br' }
    if (part.startsWith('`')) return { t: 'code', v: part.slice(1, -1) }
    if (part.startsWith('**')) return { t: 'bold', v: part.slice(2, -2) }
    return { t: 'text', v: part }
  })
}

export function proseBlocks(markdown: string): readonly ProseBlock[] {
  return markdown.split(/```[\w-]*\n?/).flatMap((chunk, index): ProseBlock[] => index % 2 === 1
    ? [{ code: true, text: chunk.replace(/\n$/, '') }]
    : chunk.split(/\n{2,}/).filter(block => block.trim() !== '').map(block => ({ code: false, runs: inline(block) })))
}

/** A `<br>` counts as one character, `\n`, in this text and in the window's ranges. */
export const proseText = (block: ProseBlock) => (block.code ? block.text : block.runs.map(run => (run.t === 'br' ? '\n' : run.v)).join(''))
