import { type RefObject, useLayoutEffect, useRef, useState } from 'react'
import { prefersReducedMotion } from '../lib/motion'
import { type EditorSection, maximizedOrigin } from './useEditorSections'

const MAXIMIZE_MS = 240
const EASE_STANDARD = 'cubic-bezier(0.2, 0, 0, 1)'
const FULL: Keyframe = { transform: 'none', clipPath: 'inset(0px 0px 0px 0px)', opacity: 1 }

function frameOf(rect: DOMRect): Keyframe {
  const { clientWidth, clientHeight } = document.documentElement
  const scale = Math.max(rect.width / clientWidth, rect.height / clientHeight)
  const right = clientWidth - rect.width / scale
  const bottom = clientHeight - rect.height / scale
  return {
    transform: `translate(${rect.left}px, ${rect.top}px) scale(${scale})`,
    clipPath: `inset(0px ${right}px ${bottom}px 0px)`,
    opacity: 0,
  }
}

export function useMaximizeMotion(maximized: EditorSection | null): {
  overlayRef: RefObject<HTMLDivElement | null>
  leaving: EditorSection | null
} {
  const overlayRef = useRef<HTMLDivElement>(null)
  const running = useRef<Animation | null>(null)
  const settled = useRef(maximized)
  const [seen, setSeen] = useState(maximized)
  const [leaving, setLeaving] = useState<EditorSection | null>(null)
  if (seen !== maximized) {
    setSeen(maximized)
    setLeaving(maximized === null && !prefersReducedMotion() ? seen : null)
  }
  useLayoutEffect(() => () => running.current?.cancel(), [])
  useLayoutEffect(() => {
    const was = settled.current
    settled.current = maximized
    if ((was === null) === (maximized === null)) return
    const el = overlayRef.current
    const rect = maximizedOrigin()
    const prev = running.current
    running.current = null
    if (!el || !rect || typeof el.animate !== 'function' || prefersReducedMotion()) {
      prev?.cancel()
      setLeaving(null)
      return
    }
    const style = getComputedStyle(el)
    const from = prev
      ? { transform: style.transform, clipPath: style.clipPath, opacity: style.opacity }
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
      if (maximized === null) setLeaving(null)
      else anim.cancel()
    }
  }, [maximized])
  return { overlayRef, leaving }
}
