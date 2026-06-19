import { useEffect, useRef } from 'react'

// One image overlay shared by the guide shots and the landing hero. It stays
// mounted so opening and closing are plain CSS transitions (interruptible,
// animate both ways); callers keep `src` set while closing so the image doesn't
// vanish mid-fade. Caption is optional — the landing zoom has none.
export default function Lightbox({
  open,
  src,
  alt,
  caption,
  closeLabel,
  onClose,
}: {
  open: boolean
  src: string | null
  alt: string
  caption?: string
  closeLabel: string
  onClose: () => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  // Read onClose through a ref so the effect can depend on `open` alone: callers
  // pass an inline arrow, and re-running on every render would thrash focus.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    // Move focus into the dialog and return it to the trigger on close, so the
    // overlay is operable and discoverable by keyboard and screen-reader users.
    const restore = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
      // The close button is the only focusable control inside the modal; pin Tab
      // to it so focus can't escape behind the overlay.
      if (e.key === 'Tab') {
        e.preventDefault()
        closeRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      restore?.focus()
    }
  }, [open])

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click-to-close is a mouse convenience; keyboard close (Escape) and the focus trap are handled by the window keydown listener above
    <div
      role="dialog"
      aria-modal="true"
      aria-label={caption ?? alt}
      onClick={onClose}
      className={`fixed inset-0 z-[60] flex cursor-zoom-out flex-col items-center justify-center gap-3 bg-bg/90 p-6 backdrop-blur-md transition-[opacity,visibility] duration-200 ${
        open ? 'visible opacity-100' : 'invisible opacity-0'
      }`}
    >
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        aria-label={closeLabel}
        className="absolute top-4 right-4 z-10 flex size-10 cursor-pointer items-center justify-center rounded-full border border-line bg-bg/60 text-fg backdrop-blur transition hover:border-blue/60 hover:text-blue focus:outline-none focus-visible:ring-2 focus-visible:ring-blue"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className="size-4.5"
          aria-hidden="true"
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
      {src && (
        <>
          <img
            src={src}
            alt={alt}
            className={`max-h-[85vh] max-w-full rounded-xl border border-line transition-[scale] duration-200 ${
              open ? 'scale-100' : 'scale-[0.97]'
            }`}
          />
          {caption && (
            <p className="max-w-xl text-center font-mono text-xs text-muted">{caption}</p>
          )}
        </>
      )}
    </div>
  )
}
