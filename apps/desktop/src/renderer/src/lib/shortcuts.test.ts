import { describe, expect, it } from 'vitest'
import { formatShortcut } from './shortcuts'

describe('formatShortcut', () => {
  it('stacks the mac glyphs with no separator, the native macOS style', () => {
    expect(formatShortcut(['mod', 'O'], true)).toBe('⌘O')
    expect(formatShortcut(['mod', 'shift', 'enter'], true)).toBe('⌘⇧↵')
    expect(formatShortcut(['mod', 'backspace'], true)).toBe('⌘⌫')
    expect(formatShortcut(['mod', ','], true)).toBe('⌘,')
  })

  it('spells the modifiers out joined with + off mac, because ⌘ and the glyphs are mac-only and read as gibberish on Windows', () => {
    expect(formatShortcut(['mod', 'O'], false)).toBe('Ctrl+O')
    expect(formatShortcut(['mod', 'shift', 'enter'], false)).toBe('Ctrl+Shift+Enter')
    expect(formatShortcut(['mod', 'backspace'], false)).toBe('Ctrl+Backspace')
    expect(formatShortcut(['mod', ','], false)).toBe('Ctrl+,')
  })
})
