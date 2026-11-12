import { type RefObject, useLayoutEffect, useRef, useState } from 'react'
import { prefersReducedMotion } from '../lib/motion'
import { sectionRect } from '../lib/sectionRect'
import { type EditorSection, maximizedOrigin } from './useEditorSections'

const MAXIMIZE_MS = 240
const EASE_STANDARD = 'cubic-bezier(0.2, 0, 0, 1)'
const FULL: Keyframe = { transform: 'none', opacity: 1 }

function frameOf(rect: DOMRect): Keyframe {
  const sx = rect.width / window.innerWidth
  const sy = rect.height / window.innerHeight
  return { transform: `translate(${rect.left}px, ${rect.top}px) scale(${sx}, ${sy})`, opacity: 0 }
}

export function useMaximizeMotion(maximized: EditorSection | null): {
  overlayRef: RefObject<HTMLDivElement | null>
  closing: boolean
} {
  const overlayRef = useRef<HTMLDivElement>(null)
  const running = useRef<Animation | null>(null)
  const settled = useRef(maximized)
  const [seen, setSeen] = useState(maximized)
  const [closing, setClosing] = useState(false)
  if (seen !== maximized) {
    setSeen(maximized)
    setClosing(seen !== null && maximized === null && !prefersReducedMotion())
  }
  useLayoutEffect(() => {
    const was = settled.current
    settled.current = maximized
    if ((was === null) === (maximized === null)) return
    const el = overlayRef.current
    const rect = was !== null && maximized === null ? sectionRect(was) : maximizedOrigin()
    const prev = running.current
    running.current = null
    if (!el || !rect || typeof el.animate !== 'function' || prefersReducedMotion()) {
      prev?.cancel()
      setClosing(false)
      return
    }
    const style = getComputedStyle(el)
    const from = prev
      ? { transform: style.transform, opacity: style.opacity }
      : maximized === null
        ? FULL
        : frameOf(rect)
    const duration = prev ? Number(prev.currentTime ?? MAXIMIZE_MS) : MAXIMIZE_MS
    prev?.cancel()
    const anim = el.animate([from, maximized === null ? frameOf(rect) : FULL], {
      duration,
      easing: EASE_STANDARD,
      fill: 'forwards',
    })
    running.current = anim
    anim.onfinish = () => {
      running.current = null
      if (maximized === null) setClosing(false)
      else anim.cancel()
    }
  }, [maximized])
  return { overlayRef, closing }
}
