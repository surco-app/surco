import { describe, expect, it } from 'vitest'
import { createDragDepth } from './dragDepth'

describe('createDragDepth', () => {
  // The bug this exists for: dragenter/dragleave fire for every element the pointer
  // crosses, not just the window edge. Entering the root and then moving onto a child
  // fires leave(root-child-boundary) while the file is still very much inside — a plain
  // boolean turns the drop hint off mid-drag and the whole column flickers as the user
  // moves the mouse.
  it('stays active while the pointer crosses onto a child', () => {
    const depth = createDragDepth()
    expect(depth.enter()).toBe(true)
    // Pointer moves from the root onto a child: one enter (child) then one leave (root).
    depth.enter()
    expect(depth.leave()).toBe(true)
  })

  it('goes inactive only when the last enter is matched', () => {
    const depth = createDragDepth()
    depth.enter()
    depth.enter()
    expect(depth.leave()).toBe(true)
    expect(depth.leave()).toBe(false)
  })

  // A drop ends the drag outright, however deep the pointer was. If the count survived the
  // drop, the next drag would inherit that depth: the hint would light on entry but the
  // matching leave would not turn it off, leaving the column stuck lit. So this checks the
  // depth is genuinely cleared — one enter, one leave, closed.
  it('resets to inactive on drop', () => {
    const depth = createDragDepth()
    depth.enter()
    depth.enter()
    depth.enter()
    expect(depth.reset()).toBe(false)
    expect(depth.enter()).toBe(true)
    expect(depth.leave()).toBe(false)
  })

  // Leaving can fire more leaves than enters (dragging out over a child that is itself
  // unmounting). An unclamped count would go negative, and the debt has to be paid off
  // before the hint ever lights again: the user drags a folder in and the column stays
  // dark. Asserted as "the very next enter is already inside", which is the symptom.
  it('never sinks below zero', () => {
    const depth = createDragDepth()
    depth.leave()
    depth.leave()
    expect(depth.enter()).toBe(true)
  })
})
