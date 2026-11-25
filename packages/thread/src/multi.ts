import type { PromptReply } from '@highwing/hermes/domain'

/**
 * The answer to a question that takes several answers, encoded as Hermes's own clients send it
 * (tools/clarify_tool.py `_clean_answer`): the checked labels, in the order they were checked, as a
 * JSON array string, with the typed "Other" answer last. Typed words alone go as plain text, which
 * Hermes reads as one answer. null when nothing is checked or typed, so there is nothing to send.
 */
export function multiReply({ picked, other }: { readonly picked: readonly string[]; readonly other: string }): PromptReply | null {
  const typed = other.trim()
  if (picked.length === 0) return typed === '' ? null : { kind: 'text', value: typed }
  return { kind: 'text', value: JSON.stringify(typed === '' ? picked : [...picked, typed]) }
}

export function multiAnswers(value: string): readonly string[] | null {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) && parsed.every(item => typeof item === 'string') ? parsed : null
  } catch {
    return null
  }
}
