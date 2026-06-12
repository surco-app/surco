import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import type React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ModalShell } from './ModalShell'

interface Props {
  // What the editor is already showing — full-size for http/blob covers, the 512px
  // thumbnail for embedded art. Shown immediately so the lightbox never opens blank.
  src: string
  // The audio file whose embedded art `src` is a thumbnail of. Set only when the
  // displayed cover IS the file's own art: the lightbox then pulls the original at
  // full resolution, since scaling up the thumbnail would lie about its quality.
  fullResFrom?: string
  onClose: () => void
}

// The cover at full size: opened by clicking the editor's 160px artwork well, closed
// by the backdrop, the × or Escape. Shows the image's real pixel size underneath,
// the same readout the well shows for the thumbnail.
export function CoverLightbox({ src, fullResFrom, onClose }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  // Keyed by path like every analysis query, so reopening the lightbox (or another
  // editor visit to the same file) never re-extracts the artwork.
  const { data: fullSrc } = useQuery({
    queryKey: ['coverFull', fullResFrom],
    queryFn: () => (fullResFrom ? window.api.readCoverFull(fullResFrom) : null),
    enabled: !!fullResFrom,
  })

  // App's global Escape only closes App-owned modals; the lightbox is editor-local,
  // so it dismisses itself (a no-op overlap: with no app modal open, App's handler
  // does nothing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <ModalShell
      onClose={onClose}
      backdropTestId="cover-lightbox-backdrop"
      dialogTestId="cover-lightbox"
      label={tr('editor.coverView')}
      className="flex max-h-[90vh] max-w-[90vw] flex-col items-center gap-2"
    >
      <img
        data-testid="cover-lightbox-img"
        src={fullSrc ?? src}
        alt={tr('editor.coverAlt')}
        onLoad={(e) =>
          setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
        }
        className="max-h-[82vh] max-w-[90vw] rounded-xl object-contain outline outline-1 -outline-offset-1 outline-white/10"
      />
      {dims && (
        <span data-testid="cover-lightbox-resolution" className="text-xs tabular-nums text-fg-dim">
          {dims.w} × {dims.h} px
        </span>
      )}
      <button
        type="button"
        data-testid="cover-lightbox-close"
        onClick={onClose}
        aria-label={tr('common.close')}
        className="press absolute top-2 right-2 rounded-lg bg-black/60 p-1.5 text-white hover:bg-black/75"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </ModalShell>
  )
}
