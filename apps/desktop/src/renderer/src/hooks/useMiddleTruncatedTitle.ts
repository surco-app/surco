import { type RefObject, useLayoutEffect, useRef, useState } from 'react'
import { truncateTitleMiddle } from '../lib/truncateTitle'

type Box = { width: number; font: string; spacing: string }

const fitted = new Map<string, string>()
let context: OffscreenCanvasRenderingContext2D | null | undefined

function fitTitle(title: string, { width, font, spacing }: Box): string {
  const key = `${font}|${spacing}|${width}|${title}`
  const known = fitted.get(key)
  if (known !== undefined) return known
  context ??= new OffscreenCanvas(1, 1).getContext('2d')
  const ctx = context
  if (!ctx) return title
  ctx.font = font
  ctx.letterSpacing = spacing === 'normal' ? '0px' : spacing
  const out = truncateTitleMiddle(title, width, (s) => ctx.measureText(s).width)
  if (fitted.size > 4000) fitted.clear()
  fitted.set(key, out)
  return out
}

export function useMiddleTruncatedTitle(title: string): {
  ref: RefObject<HTMLSpanElement | null>
  text: string
} {
  const ref = useRef<HTMLSpanElement>(null)
  const [box, setBox] = useState<Box | null>(null)
  const versioned = title.endsWith(')')
  useLayoutEffect(() => {
    const el = ref.current
    const slot = el?.parentElement
    if (
      !el ||
      !slot ||
      !versioned ||
      typeof ResizeObserver === 'undefined' ||
      typeof OffscreenCanvas === 'undefined'
    )
      return
    const ro = new ResizeObserver(([entry]) => {
      const style = getComputedStyle(el)
      const next = {
        width: Math.floor(entry.contentRect.width),
        font: `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`,
        spacing: style.letterSpacing,
      }
      setBox((was) =>
        was?.width === next.width && was.font === next.font && was.spacing === next.spacing
          ? was
          : next,
      )
    })
    ro.observe(slot)
    return () => ro.disconnect()
  }, [versioned])
  return { ref, text: versioned && box ? fitTitle(title, box) : title }
}
