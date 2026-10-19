import { describe, expect, it } from 'vitest'
import { popoverPlacement } from './popoverPlacement'

describe('popoverPlacement', () => {
  it('opens downward when the whole popover fits below the field', () => {
    expect(popoverPlacement({ above: 600, below: 400, height: 380 })).toEqual({
      side: 'down',
      maxHeight: 400,
    })
  })

  it('opens upward when it does not fit below and there is more room above, so the convert footer never covers the tree', () => {
    expect(popoverPlacement({ above: 600, below: 290, height: 380 })).toEqual({
      side: 'up',
      maxHeight: 600,
    })
  })

  it('stays downward, capped to the room below, when above is no roomier', () => {
    expect(popoverPlacement({ above: 120, below: 200, height: 380 })).toEqual({
      side: 'down',
      maxHeight: 200,
    })
  })

  it('caps the upward popover to the room above when neither side fits it whole', () => {
    expect(popoverPlacement({ above: 250, below: 90, height: 380 })).toEqual({
      side: 'up',
      maxHeight: 250,
    })
  })

  it('never asks for a negative height when the field sits at the very edge', () => {
    expect(popoverPlacement({ above: -10, below: -20, height: 380 }).maxHeight).toBe(0)
  })
})
