export interface PopoverPlacement {
  side: 'down' | 'up'
  maxHeight: number
}

export function popoverPlacement({
  above,
  below,
  height,
}: {
  above: number
  below: number
  height: number
}): PopoverPlacement {
  if (height <= below || below >= above) return { side: 'down', maxHeight: Math.max(below, 0) }
  return { side: 'up', maxHeight: Math.max(above, 0) }
}
