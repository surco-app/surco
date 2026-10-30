import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import type { ColumnShares } from '../../../shared/types'
import {
  type ColumnWidths,
  columnWidths,
  DIVIDERS_WIDTH,
  RAIL_WIDTH,
  type ResizableColumn,
  shareFor,
} from '../lib/columnLayout'
import { useStableCallback } from './useStableCallback'

interface Params {
  hasTree: boolean
  saved: ColumnShares | undefined
  onCommit: (shares: ColumnShares) => void
}

export function useColumnLayout({ hasTree, saved, onCommit }: Params): {
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
  const available = windowWidth - RAIL_WIDTH - DIVIDERS_WIDTH
  const widths = columnWidths(available, hasTree, shares)

  const settle = (
    column: ResizableColumn,
    requested: number,
    base: ColumnShares | undefined,
  ): { width: number; shares: ColumnShares } => {
    const asked = { ...base, [column]: shareFor(column, requested, available, hasTree, base) }
    const width = columnWidths(available, hasTree, asked)[column]
    return {
      width,
      shares: { ...base, [column]: shareFor(column, width, available, hasTree, base) },
    }
  }

  const startResize = useStableCallback((column: ResizableColumn, e: React.PointerEvent): void => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = widths[column]
    const base = shares
    const settleAt = (x: number) => settle(column, startWidth + x - startX, base)
    let frame = 0
    let latestX = startX
    function onMove(ev: PointerEvent): void {
      latestX = ev.clientX
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        setDraft(settleAt(latestX).shares)
      })
    }
    function cleanup(): void {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', cleanup)
      document.body.style.cursor = ''
      endDrag.current = null
      setDraft(null)
      const end = settleAt(latestX)
      if (end.width !== startWidth) onCommit(end.shares)
    }
    endDrag.current = cleanup
    document.body.style.cursor = 'col-resize'
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', cleanup)
  })

  const fit = useStableCallback((column: ResizableColumn, deficit: number): void => {
    if (deficit === 0) return
    const end = settle(column, widths[column] + deficit, shares)
    if (end.width !== widths[column]) onCommit(end.shares)
  })

  return { widths, startResize, fit }
}
