import { useEffect } from 'react'

// One image overlay shared by the guide shots and the landing hero. It stays
// mounted so opening and closing are plain CSS transitions (interruptible,
// animate both ways); callers keep `src` set while closing so the image doesn't
// vanish mid-fade. Caption is optional — the landing zoom has none.
export default function Lightbox({
  open,
  src,
  alt,
  caption,
  onClose,
}: {
  open: boolean
  src: string | null
  alt: string
  caption?: string
  onClose: () => void
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={caption ?? alt}
      onClick={onClose}
      className={`fixed inset-0 z-[60] flex cursor-zoom-out flex-col items-center justify-center gap-3 bg-bg/90 p-6 backdrop-blur-md transition-[opacity,visibility] duration-200 ${
        open ? 'visible opacity-100' : 'invisible opacity-0'
      }`}
    >
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
