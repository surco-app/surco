import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadWindowState, resolveWindowBounds, saveWindowState } from './windowState'

const display = { x: 0, y: 0, width: 1920, height: 1080 }
const size = { width: 1320, height: 820 }
const min = { width: 1080, height: 620 }

describe('resolveWindowBounds', () => {
  it('keeps the size and position the window was closed at while its display is connected', () => {
    const saved = { x: 200, y: 100, width: 1500, height: 900 }
    expect(resolveWindowBounds(saved, [display], size, min)).toEqual(saved)
  })

  it('falls back to the default size when the display it was on is unplugged', () => {
    const saved = { x: 2200, y: 100, width: 1500, height: 900 }
    expect(resolveWindowBounds(saved, [display], size, min)).toEqual(size)
  })

  it('falls back to the default size when nothing was saved yet', () => {
    expect(resolveWindowBounds(null, [display], size, min)).toEqual(size)
  })

  it('never reopens smaller than the layout can fit', () => {
    const saved = { x: 10, y: 10, width: 400, height: 300 }
    expect(resolveWindowBounds(saved, [display], size, min)).toEqual({
      x: 10,
      y: 10,
      width: 1080,
      height: 620,
    })
  })

  it('finds the window on a secondary display', () => {
    const second = { x: 1920, y: 0, width: 1440, height: 900 }
    const saved = { x: 2000, y: 50, width: 1200, height: 800 }
    expect(resolveWindowBounds(saved, [display, second], size, min)).toEqual(saved)
  })

  it('falls back when the window would sit mostly outside the screen with only a sliver visible', () => {
    const saved = { x: 1900, y: 100, width: 1500, height: 900 }
    expect(resolveWindowBounds(saved, [display], size, min)).toEqual(size)
  })
})

describe('window state file', () => {
  const file = () => join(mkdtempSync(join(tmpdir(), 'surco-win-')), 'window-state.json')

  it('round-trips bounds and the maximized flag so a maximized window reopens maximized', () => {
    const path = file()
    const state = { bounds: { x: 1, y: 2, width: 1300, height: 800 }, maximized: true }
    saveWindowState(path, state)
    expect(loadWindowState(path)).toEqual(state)
  })

  it('throws on an unwritable path so the caller can log why the state was lost', () => {
    const path = join(file(), 'missing-dir', 'window-state.json')
    expect(() =>
      saveWindowState(path, { bounds: { x: 0, y: 0, width: 1, height: 1 }, maximized: false }),
    ).toThrow()
  })

  it('treats a missing file as no saved state', () => {
    expect(loadWindowState(file())).toBeNull()
  })

  it('treats a corrupt file as no saved state instead of blocking launch', () => {
    const path = file()
    writeFileSync(path, '{nope')
    expect(loadWindowState(path)).toBeNull()
  })

  it('rejects non-numeric bounds from a hand-edited file', () => {
    const path = file()
    writeFileSync(
      path,
      JSON.stringify({ bounds: { x: 'a', y: 0, width: 1, height: 1 }, maximized: false }),
    )
    expect(loadWindowState(path)).toBeNull()
  })
})
