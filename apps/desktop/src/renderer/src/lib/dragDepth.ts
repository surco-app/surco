// dragenter/dragleave fire per element, not per window: crossing from the drop container
// onto any child inside it fires a leave while the file is still over the window. Tracking
// a boolean off those events makes the drop hint flicker for the whole drag. Counting the
// enters and only going inactive when the last one is matched is the standard fix — the
// pointer is inside as long as more enters than leaves have been seen.
export interface DragDepth {
  // Each returns whether the pointer is still inside after the event.
  enter(): boolean
  leave(): boolean
  reset(): boolean
}

export function createDragDepth(): DragDepth {
  let depth = 0
  return {
    enter() {
      depth += 1
      return depth > 0
    },
    leave() {
      // Clamped because a drag that leaves over an unmounting child can report more leaves
      // than enters; a negative depth would read as "inside" on the next drag.
      depth = Math.max(0, depth - 1)
      return depth > 0
    },
    reset() {
      depth = 0
      return false
    },
  }
}
