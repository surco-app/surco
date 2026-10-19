import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import type { ColumnShares } from '../../../shared/types'
import {
  COLUMN_LIMITS,
  type ColumnWidths,
  columnWidths,
  RAIL_WIDTH,
  type ResizableColumn,
  shareFor,
} from '../lib/columnLayout'
import { nextWidth } from '../lib/resize'
import { useStableCallback } from './useStableCallback'

interface Params {
  hasRail: boolean
  hasTree: boolean
  saved: ColumnShares | undefined
  onCommit: (shares: ColumnShares) => void
}

export function useColumnLayout({ hasRail, hasTree, saved, onCommit }: Params): {
  widths: ColumnWidths
  startResize: (column: ResizableColumn, e: React.PointerEvent) => void
  fit: (column: ResizableColumn, deficit: number) => void
} {
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth)
  const [draft, setDraft] = useState<ColumnShares | null>(null)
  const endDrag = useRef<(() => void) | null>(null)

  useEffect(() => {
    let frame = 0
    function onResize(): void {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        setWindowWidth(window.innerWidth)
      })
    }
    setWindowWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  useEffect(() => () => endDrag.current?.(), [])

  const shares = draft ?? saved
  const available = windowWidth - (hasRail ? RAIL_WIDTH : 0)
  const widths = columnWidths(available, hasTree, shares)

  const startResize = useStableCallback((column: ResizableColumn, e: React.PointerEvent): void => {
    e.preventDefault()
    const { min, max } = COLUMN_LIMITS[column]
    const startX = e.clientX
    const startWidth = widths[column]
    const base = shares
    const sharesAt = (x: number): ColumnShares => ({
      ...base,
      [column]: shareFor(
        column,
        nextWidth(startWidth, x - startX, min, max),
        available,
        hasTree,
        base,
      ),
    })
    let frame = 0
    let latestX = startX
    function onMove(ev: PointerEvent): void {
      latestX = ev.clientX
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        setDraft(sharesAt(latestX))
      })
    }
    function cleanup(): void {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', cleanup)
      document.body.style.cursor = ''
      endDrag.current = null
      setDraft(null)
      if (nextWidth(startWidth, latestX - startX, min, max) !== startWidth)
        onCommit(sharesAt(latestX))
    }
    endDrag.current = cleanup
    document.body.style.cursor = 'col-resize'
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', cleanup)
  })

  const fit = useStableCallback((column: ResizableColumn, deficit: number): void => {
    if (deficit === 0) return
    const { min, max } = COLUMN_LIMITS[column]
    const next = nextWidth(widths[column], deficit, min, max)
    if (next === widths[column]) return
    onCommit({ ...shares, [column]: shareFor(column, next, available, hasTree, shares) })
  })

  return { widths, startResize, fit }
}
