import { describe, expect, it } from 'vitest'
import { TABS, tabAfterKey } from '../src/renderer/apps/connectors-tabs'

describe('the Connectors screen tabs', () => {
  it('has five tabs, Templates last', () => {
    expect(TABS.map(item => item.label)).toEqual(['Skills', 'Plugins', 'Connectors', 'Tools', 'Templates'])
  })

  it('steps Right through every tab and back to the first', () => {
    expect(TABS.map((_, at) => tabAfterKey(at, 'ArrowRight'))).toEqual(['plugins', 'connectors', 'tools', 'templates', 'skills'])
  })

  it('steps Left through every tab and back to the last', () => {
    expect(TABS.map((_, at) => tabAfterKey(at, 'ArrowLeft'))).toEqual(['templates', 'skills', 'plugins', 'connectors', 'tools'])
  })

  it('leaves every other key alone', () => {
    expect(tabAfterKey(2, 'Enter')).toBeNull()
    expect(tabAfterKey(2, 'ArrowDown')).toBeNull()
  })
})
