import type React from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

interface Props<T extends string> {
  options: readonly T[]
  value: T
  onChange: (value: T) => void
  // Each option's data-testid is `${testidPrefix}-${option}`.
  testidPrefix: string
  labelFor: (option: T) => string
  // Extra container classes (margins) — the pill styling itself is fixed.
  className?: string
}

// The option row used for normalization mode, theme, output format and key notation
// (here and in onboarding). A recessed track holds the segments so the row reads as
// one setting with N values rather than tabs or loose buttons — the mistake that
// prompted it: content below a bare row reads as the active tab's content. Same
// treatment, larger, as the waveform compare's view switcher; the toolbar's focus
// presets stay trackless on purpose, since none of them may be active and a track
// with no raised segment looks broken. One definition so the instances can't drift
// in styling or in the aria-pressed wiring.
//
// The raised segment is not painted on the buttons: it is an aria-hidden copy of the
// whole row, clipped to the active option, so switching SLIDES the relief along the
// track instead of teleporting it — the visual claim that this is one value moving
// between positions. Clipping (not a measured thumb) keeps the active label's color
// inside the moving highlight, so text and background can never fall out of sync.
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  testidPrefix,
  labelFor,
  className,
}: Props<T>): React.JSX.Element {
  const overlayRef = useRef<HTMLDivElement>(null)
  // null = no real measurement yet. A control can mount before it has geometry (a
  // hidden wizard step, a modal mid-entrance): zeros read as clip inset(0 0 0 0) —
  // the WHOLE track raised — and the first real measurement then slid the highlight
  // from both edges onto the active segment. Until geometry lands, no highlight.
  const [clip, setClip] = useState<{ left: number; right: number } | null>(null)
  // The slide is for changing VALUE, never for arriving on screen: the transition
  // class is withheld until one real clip has painted, so the first measurement
  // (and the first after being re-hidden) lands instantly.
  const [settled, setSettled] = useState(false)
  // Measured before paint, so the highlight lands on the mounted value without a
  // slide from the far left. The ResizeObserver re-measures when the labels change
  // width under it (language switch, late font) — the value itself is a dep, so a
  // pick re-measures directly and the clip transition does the travelling.
  useLayoutEffect(() => {
    const overlay = overlayRef.current
    const track = overlay?.parentElement
    const measure = (): void => {
      const active = track?.querySelector<HTMLButtonElement>(
        `[data-testid="${testidPrefix}-${value}"]`,
      )
      if (!overlay || !active) return
      // Layout metrics, not getBoundingClientRect: viewport rects shrink with an
      // ancestor transform (the settings modal pops in at scale 0.98) while the clip
      // applies in unscaled local space, so a rect-based clip landed ~2% off and
      // showed a sliver of the neighbouring copy — for good, because ResizeObserver
      // ignores transforms and never re-measured. offsetLeft shares the overlay's
      // origin: both are laid out against the track's padding box.
      const width = overlay.offsetWidth
      if (width === 0) {
        setClip(null)
        setSettled(false)
        return
      }
      setClip({ left: active.offsetLeft, right: width - active.offsetLeft - active.offsetWidth })
    }
    measure()
    if (!track || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(track)
    return () => ro.disconnect()
  }, [value, testidPrefix])
  useEffect(() => {
    if (clip) setSettled(true)
  }, [clip])
  return (
    <div
      // self-start: several callers stack settings in a flex column, whose default
      // stretch would pull the track to the panel's full width now that it paints a box.
      className={`relative inline-flex gap-0.5 self-start rounded-[9px] border border-[var(--color-line)] bg-[var(--color-field)] p-[3px] ${className ?? ''}`}
    >
      {options.map((id) => (
        <button
          key={id}
          type="button"
          data-testid={`${testidPrefix}-${id}`}
          aria-pressed={value === id}
          onClick={() => onChange(id)}
          // The buttons themselves all stay quiet — the overlay below paints the
          // raised state — so a segment the highlight is leaving fades back to muted
          // exactly as the clip uncovers it. Hover previews the fill without relief.
          className="rounded-md px-4 py-1.5 text-sm text-fg-muted transition-colors hover:bg-[var(--color-panel-2)] hover:text-fg"
        >
          {labelFor(id)}
        </button>
      ))}
      <div
        ref={overlayRef}
        data-testid={`${testidPrefix}-highlight`}
        aria-hidden="true"
        // Mirrors the row's exact layout (same padding, gap and type), every copy
        // painted raised, then clips down to the active option's box. clip-path is
        // composited and a transition retargets from the current clip, so rapid
        // clicks redirect the slide mid-flight instead of restarting it.
        className={`absolute inset-0 flex gap-0.5 p-[3px] motion-reduce:transition-none ${
          settled ? 'transition-[clip-path] duration-200 ease-[cubic-bezier(0.645,0.045,0.355,1)]' : ''
        }`}
        style={
          clip
            ? {
                pointerEvents: 'none',
                clipPath: `inset(0 ${clip.right}px 0 ${clip.left}px round 6px)`,
              }
            : { pointerEvents: 'none', visibility: 'hidden' }
        }
      >
        {options.map((id) => (
          <span
            key={id}
            className="rounded-md bg-[var(--color-panel-2)] px-4 py-1.5 text-sm text-fg shadow-[0_1px_2px_rgba(0,0,0,0.3),inset_0_0_0_1px_var(--color-line-strong)]"
          >
            {labelFor(id)}
          </span>
        ))}
      </div>
    </div>
  )
}
