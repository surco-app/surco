import { Minimize2 } from 'lucide-react'
import type React from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { CueTrackInfo } from './CuesSection'
import { WaveformSkeleton } from './WaveformSkeleton'

function Pill({ className }: { className: string }): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={`shrink-0 skeleton-sweep rounded-md bg-[var(--color-panel-2)] ${className}`}
    />
  )
}

function Measuring(): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <p data-testid="cues-measuring" className="min-w-0 truncate text-xs text-fg-dim">
      {t('editor.cues.provisional.measuring')}
    </p>
  )
}

function Maximized({
  track,
  label,
  measuring,
  onRestore,
}: {
  track?: CueTrackInfo
  label: string
  measuring: boolean
  onRestore: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <>
      <div className="flex shrink-0 items-center gap-3 border-b border-[var(--color-line)] pb-3">
        {track?.cover ? (
          <img src={track.cover} alt="" className="h-10 w-10 shrink-0 rounded-md object-cover" />
        ) : (
          <div
            aria-hidden="true"
            className="h-10 w-10 shrink-0 rounded-md bg-[var(--color-panel-2)]"
          />
        )}
        <div className="flex min-w-0 flex-col gap-0.5">
          <div
            data-testid="cues-skeleton-title"
            className="truncate text-base font-semibold text-fg"
          >
            {track?.title || label}
          </div>
          <div className="flex min-w-0 items-center gap-1.5 text-xs">
            {track?.artist && (
              <>
                <span data-testid="cues-skeleton-artist" className="truncate text-fg-dim">
                  {track.artist}
                </span>
                <span aria-hidden="true" className="text-fg-faint">
                  ·
                </span>
              </>
            )}
            <Pill className="h-2.5 w-8" />
          </div>
        </div>
        <span className="flex-1" />
        <Pill className="h-6 w-6" />
        <Pill className="h-7 w-36" />
        <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-[var(--color-line-strong)]" />
        <Pill className="h-8 w-8" />
        <button
          type="button"
          data-testid="section-maximize"
          aria-label={t('editor.sectionRestore')}
          onClick={onRestore}
          className="press flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-fg-faint transition-colors hover:bg-[var(--color-line-strong)] hover:text-fg"
        >
          <Minimize2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="flex h-8 shrink-0 items-center gap-2">
        <Pill className="h-7 w-28" />
        <Pill className="h-8 w-28" />
        <span className="flex-1" />
        <Pill className="h-4 w-14" />
        <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-[var(--color-line-strong)]" />
        <Pill className="h-6 w-24" />
        <Pill className="h-6 w-16" />
      </div>
      <div style={{ minHeight: '36px' }} className="flex shrink-0 flex-col justify-center gap-1">
        {measuring && <Measuring />}
      </div>
      <div className="relative h-11 shrink-0 overflow-hidden rounded-md bg-[var(--color-panel-2)]">
        <WaveformSkeleton testid="cues-skeleton-strip" />
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col" style={{ maxHeight: '360px' }}>
        <div className="relative flex-1" style={{ minHeight: '160px' }}>
          <WaveformSkeleton testid="cues-skeleton-detail" />
        </div>
      </div>
      <div className="mt-3 flex shrink-0 items-center gap-x-2">
        <Pill className="h-6 w-6" />
        <Pill className="h-7 w-72" />
        <Pill className="h-7 w-28" />
        <Pill className="h-7 w-32" />
        <Pill className="h-7 w-80" />
      </div>
    </>
  )
}

function Folded({ measuring }: { measuring: boolean }): React.JSX.Element {
  return (
    <>
      <div className="overflow-hidden rounded-md bg-[var(--color-panel-2)]">
        <div className="relative h-[44px] border-b border-[var(--color-line)]">
          <WaveformSkeleton testid="cues-skeleton-strip" />
        </div>
        <div className="relative h-[96px]">
          <WaveformSkeleton testid="cues-skeleton-detail" />
        </div>
      </div>
      <div className="mt-2 flex h-7 min-w-0 items-center gap-2">
        <Pill className="h-6 w-6" />
        <Pill className="h-7 w-20" />
        {measuring ? <Measuring /> : <Pill className="h-3.5 w-11" />}
        <span className="flex-1" />
        <Pill className="h-6 w-16" />
        <Pill className="h-6 w-6" />
      </div>
    </>
  )
}

export function CuesSkeleton({
  maximized,
  measuring,
  track,
  label,
  headerSlot,
  onRestore,
}: {
  maximized: boolean
  measuring: boolean
  track?: CueTrackInfo
  label: string
  headerSlot: HTMLElement | null
  onRestore: () => void
}): React.JSX.Element {
  return (
    <div
      data-testid="cues-skeleton"
      data-maximized={maximized ? 'true' : 'false'}
      className={maximized ? 'flex min-h-0 flex-1 flex-col gap-3' : undefined}
    >
      {maximized ? (
        <Maximized track={track} label={label} measuring={measuring} onRestore={onRestore} />
      ) : (
        <Folded measuring={measuring} />
      )}
      {!maximized && headerSlot && createPortal(<Pill className="h-6 w-28" />, headerSlot)}
    </div>
  )
}
