import type { ApprovalMode } from '@highwing/hermes/domain'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Approvals } from '../src/renderer/composer/Approvals'

const button = (mode: ApprovalMode, yolo: boolean) => {
  const markup = renderToStaticMarkup(<Approvals mode={mode} yolo={yolo} onMode={() => new Promise(() => {})} onYolo={() => new Promise(() => {})} />)
  return markup.slice(0, markup.indexOf('<dialog')).replace(/<[^>]*>/g, '')
}

describe('the approval menu', () => {
  it('names the bot\'s mode', () => {
    expect(button('manual', false)).toBe('Manual approvals')
    expect(button('smart', false)).toBe('Smart approvals')
    expect(button('off', false)).toBe('Approvals Off')
  })

  it('reads Off while the chat\'s own YOLO runs it without asking, whatever the bot\'s mode', () => {
    expect(button('smart', true)).toBe('Approvals Off')
    expect(button('manual', true)).toBe('Approvals Off')
  })

  it('holds no YOLO button', () => {
    const markup = renderToStaticMarkup(<Approvals mode="smart" yolo onMode={() => new Promise(() => {})} onYolo={() => new Promise(() => {})} />)
    expect(markup).not.toMatch(/YOLO/)
    expect(markup.match(/<button/g)).toHaveLength(3)
  })
})
