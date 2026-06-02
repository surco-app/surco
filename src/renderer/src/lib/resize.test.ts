import { describe, expect, it } from 'vitest'
import { nextWidth } from './resize'

describe('nextWidth', () => {
  it('adds the drag delta to the width the user started from', () => {
    expect(nextWidth(300, 40, 200, 480)).toBe(340)
    expect(nextWidth(300, -40, 200, 480)).toBe(260)
  })

  it('clamps to the minimum so a panel can never collapse out of reach', () => {
    expect(nextWidth(300, -500, 200, 480)).toBe(200)
  })

  it('clamps to the maximum so a panel can never swallow the rest of the window', () => {
    expect(nextWidth(300, 500, 200, 480)).toBe(480)
  })
})
