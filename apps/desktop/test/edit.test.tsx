import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { removalWords } from '../src/renderer/composer/edit'
import { RemoveDialog } from '../src/renderer/composer/RemoveDialog'

describe('the removal sentence', () => {
  it.each([[1, 'This removes 1 later message.'], [2, 'This removes 2 later messages.'], [3, 'This removes 3 later messages.']])('counts %i later', (later, words) => {
    expect(removalWords(later)).toBe(words)
  })
})

describe('the removal dialog', () => {
  const markup = renderToStaticMarkup(<RemoveDialog later={3} onCancel={() => {}} onConfirm={() => {}} />)

  it('is named by the count and described by what cannot be undone', () => {
    const [, title] = /aria-labelledby="([^"]+)"/.exec(markup)!
    const [, detail] = /aria-describedby="([^"]+)"/.exec(markup)!
    expect(markup).toContain(`<p id="${title}" class="remove-count">This removes 3 later messages.</p>`)
    expect(markup).toContain(`<p id="${detail}">Hermes can’t bring them back.</p>`)
  })

  it('offers Cancel and Remove and send', () => {
    expect(Array.from(markup.matchAll(/<button[^>]*>([^<]*)<\/button>/g), ([, name]) => name)).toEqual(['Cancel', 'Remove and send'])
  })
})
