import {
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  Copy,
  Download,
  ImageIcon,
  type LucideIcon,
  X,
} from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DiscogsRelease } from '../../../shared/types'
import { coverSourceOf } from '../lib/coverSource'
import { revokeCoverUrl } from '../lib/coverUrl'
import { isLowResCover } from '../lib/quality'
import { stepImageIndex } from '../lib/release'
import type { TrackItem } from '../types'
import { CoverLightbox } from './CoverLightbox'
import { Tooltip } from './Tooltip'

// Pulls the candidate image URLs out of a drag that carried no file — i.e. an <img>
// dragged from a web page. Browsers expose them as text/uri-list (often the clean image
// URL, but sometimes the link the image sat inside — a page, not a picture), an <img>
// tag in text/html, or plain text. We return every http(s)/data: image URL we find, in
// that order, so main can try each and keep the first that is actually an image.
function imageUrlsFromDrag(dt: DataTransfer): string[] {
  const isImageUrl = (s: string): boolean => /^https?:\/\//i.test(s) || /^data:image\//i.test(s)
  const urls: string[] = []
  for (const line of dt.getData('text/uri-list').split('\n')) {
    const l = line.trim()
    if (l && !l.startsWith('#') && isImageUrl(l)) urls.push(l)
  }
  const fromHtml = dt.getData('text/html').match(/<img[^>]+src=["']([^"']+)["']/i)?.[1]
  if (fromHtml && isImageUrl(fromHtml)) urls.push(fromHtml)
  const plain = dt.getData('text/plain').trim()
  if (isImageUrl(plain)) urls.push(plain)
  return [...new Set(urls)]
}

// One icon button in the cover's hover action bar. pointer-events-auto so it stays
// clickable even though its parent scrim lets events through to the image beneath.
function CoverActionButton({
  testid,
  label,
  icon: Icon,
  onClick,
  danger = false,
  disabled = false,
  className = '',
}: {
  testid: string
  label: string
  icon: LucideIcon
  onClick: () => void
  danger?: boolean
  disabled?: boolean
  className?: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      data-testid={testid}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`press pointer-events-auto rounded-lg p-1.5 text-white transition-colors ${
        disabled
          ? 'cursor-not-allowed opacity-40'
          : danger
            ? 'hover:bg-danger/80'
            : 'hover:bg-white/20'
      } ${className}`}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      {!disabled && <Tooltip label={label} scope="cover" />}
    </button>
  )
}

interface Props {
  item: TrackItem
  isMulti: boolean
  selectedTracks: TrackItem[] | undefined
  // The open release, whose images join the file's own artwork in the picker.
  release: DiscogsRelease | null
  // Lifted to the editor because selectTrack reads it to decide whether a release
  // should replace a low-res existing cover; the <img> onLoad reports it back up.
  coverDims: { w: number; h: number } | null
  setCoverDims: (dims: { w: number; h: number } | null) => void
  onChange: (patch: Partial<TrackItem>) => void
  onApplyCoverAll?: (coverUrl: string, coverPath?: string) => void
}

// The album artwork well: shows the current cover (with hover remove/export), a
// drop/click target when empty, a stepper through the file's image and the release's
// alternatives, and a resolution readout. In multi-select it shows the shared cover (or
// nothing when they differ) and a pick/drop stamps it onto every selected track.
export function CoverPicker({
  item,
  isMulti,
  selectedTracks,
  release,
  coverDims,
  setCoverDims,
  onChange,
  onApplyCoverAll,
}: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  // In multi-select the cover is whatever the tracks already share (or nothing, when
  // they differ); a drop/pick stamps it onto all of them instead of just the primary.
  const sharedCover =
    isMulti && selectedTracks?.every((t) => t.coverUrl === selectedTracks[0].coverUrl)
      ? selectedTracks[0].coverUrl
      : undefined
  const displayCover = isMulti ? sharedCover : item.coverUrl
  const [coverDragging, setCoverDragging] = useState(false)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  // The artwork the file arrived with: its embedded cover, not whatever coverUrl
  // happens to hold when the editor mounts (a release match may have already filled
  // it). The picker lists it first so the user can step to the release's images and
  // back; a file with no embedded art contributes no slot, so only the release's
  // images appear.
  const [originalCover] = useState<{ url?: string; path?: string }>(() => ({
    url: item.embeddedCover,
  }))
  const coverDragPath = useRef<string | null>(null)
  const coverInputRef = useRef<HTMLInputElement>(null)

  // startDrag needs a file on disk the instant the drag begins, so prepare the
  // processed cover whenever it changes and stash its path for onDragStart.
  const { coverUrl, coverPath, embeddedCover, inputPath } = item
  useEffect(() => {
    coverDragPath.current = null
    if (!coverUrl && !coverPath) return
    let cancelled = false
    window.api
      .prepareCoverDrag(coverSourceOf({ coverUrl, coverPath, embeddedCover, inputPath }))
      .then((path) => {
        if (!cancelled) coverDragPath.current = path
      })
      // Preparing the drag-out file is best-effort: a cover that can't be decoded — a
      // hotlink-blocked or non-image URL dragged from a browser — just leaves drag-out
      // unavailable (onDragStart no-ops on a null path). Swallow it so the failure never
      // surfaces as an unhandled rejection and the raw ffmpeg error in a red toast.
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [coverUrl, coverPath, embeddedCover, inputPath])

  // Clear the stale size when the artwork changes; onLoad fills it in again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: displayCover is the trigger to reset, not a value read in the body.
  useEffect(() => setCoverDims(null), [displayCover])

  // Sets the artwork from a resolved (url, path) pair: stamps onto every selected
  // track in multi-select, otherwise just the primary. Replacing a previously picked
  // file frees its blob URL — nothing else shows it.
  function applyCover(coverUrl: string, coverPath?: string): void {
    revokeCoverUrl(item.coverUrl)
    if (isMulti) onApplyCoverAll?.(coverUrl, coverPath)
    else onChange({ coverUrl, coverPath, coverRemoved: false })
  }

  function applyImageFile(file: File | undefined): void {
    if (!file?.type.startsWith('image/')) return
    applyCover(URL.createObjectURL(file), window.api.getPathForFile(file))
  }

  // Copy/paste the artwork through the system clipboard, so a cover can be lifted off
  // one track and dropped onto another (and to/from other apps). Copy resolves the
  // source the same way export/drag-out do; paste applies the clipboard image, or
  // leaves the track untouched when the clipboard holds none.
  // The paste affordance only appears when the clipboard actually holds an image —
  // checked on mount, when the window regains focus (an image may have been copied in
  // another app), and right after our own copy.
  const [canPaste, setCanPaste] = useState(false)
  const refreshCanPaste = useCallback(() => {
    void window.api.hasClipboardImage().then(setCanPaste)
  }, [])
  useEffect(() => {
    refreshCanPaste()
    return window.api.onWindowFocus((focused) => {
      if (focused) refreshCanPaste()
    })
  }, [refreshCanPaste])

  async function onCoverCopy(): Promise<void> {
    if (isMulti || !displayCover) return
    if (await window.api.copyCoverImage(coverSourceOf(item))) setCanPaste(true)
  }
  async function onCoverPaste(): Promise<void> {
    const pasted = await window.api.pasteCoverImage()
    if (pasted) applyCover(pasted.coverUrl, pasted.coverPath)
  }

  // Cmd/Ctrl+C and Cmd/Ctrl+V act only while the cover well is hovered, so the cover's
  // own click (which opens the lightbox) is untouched and a normal copy/paste over an
  // input elsewhere is never hijacked. The listener reads the latest handlers through
  // a ref, so it subscribes once instead of on every render.
  const hoverRef = useRef(false)
  const actionsRef = useRef({ copy: onCoverCopy, paste: onCoverPaste })
  actionsRef.current = { copy: onCoverCopy, paste: onCoverPaste }
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (!hoverRef.current || !(e.metaKey || e.ctrlKey)) return
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable))
        return
      const k = e.key.toLowerCase()
      if (k === 'c') {
        e.preventDefault()
        void actionsRef.current.copy()
      } else if (k === 'v') {
        e.preventDefault()
        void actionsRef.current.paste()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  function onCoverRemove(): void {
    revokeCoverUrl(item.coverUrl)
    onChange({ coverUrl: undefined, coverPath: undefined, coverRemoved: true })
  }

  // A single hover-revealed action bar across the well's bottom edge, instead of an icon
  // in each corner: it groups the clipboard and file actions, leaves the artwork
  // unobscured at rest, and stays legible on any cover thanks to the gradient scrim.
  // Copy/export/remove act on a single track's own artwork; paste also works on a
  // coverless track and across a multi-selection — so the bar shows whatever applies.
  // Paste stays in place and just disables when the clipboard has no image, so the bar
  // never shifts as an icon pops in and out.
  const ownCover = !isMulti && Boolean(displayCover)
  const coverActions = (
    // The scrim is decorative and lets pointer events through; only the buttons take
    // them, so the rest of the strip still passes clicks to the zoom/drag image beneath.
    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1 rounded-b-xl bg-gradient-to-t from-black/75 via-black/40 to-transparent px-2 pt-7 pb-2 opacity-0 transition-opacity group-hover:opacity-100">
      {ownCover && (
        <CoverActionButton
          testid="cover-copy"
          label={tr('editor.coverCopy')}
          icon={Copy}
          onClick={() => void onCoverCopy()}
        />
      )}
      <CoverActionButton
        testid="cover-paste"
        label={tr('editor.coverPaste')}
        icon={ClipboardPaste}
        onClick={() => void onCoverPaste()}
        disabled={!canPaste}
      />
      {ownCover && (
        <CoverActionButton
          testid="cover-export"
          label={tr('editor.coverExport')}
          icon={Download}
          onClick={onCoverExport}
        />
      )}
      {ownCover && (
        <CoverActionButton
          testid="cover-remove"
          label={tr('editor.coverRemove')}
          icon={X}
          onClick={onCoverRemove}
          danger
          className="ml-auto"
        />
      )}
    </div>
  )

  function onCoverDrop(e: React.DragEvent): void {
    e.preventDefault()
    e.stopPropagation()
    setCoverDragging(false)
    const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/'))
    if (file) {
      applyImageFile(file)
      return
    }
    // An image dragged from a browser carries no file — only candidate URLs, one of which
    // may be the page the image linked to rather than the picture itself. Let main fetch
    // and validate them and hand back a CSP-safe data-URL preview (plus a local path) for
    // the first real image; a drag with no usable image leaves the artwork untouched.
    const urls = imageUrlsFromDrag(e.dataTransfer)
    if (urls.length === 0) return
    window.api
      .resolveDraggedCover(urls)
      .then((resolved) => {
        if (resolved) applyCover(resolved.coverUrl, resolved.coverPath)
      })
      .catch(() => {})
  }

  // The covers the picker steps through: the file's own artwork first, then the
  // release's images (deduped), so the original sits at index 0 and Discogs'
  // alternatives are one step away — and reachable again after stepping off.
  const coverChoices = useMemo(() => {
    const choices: { uri: string; path?: string }[] = []
    if (originalCover.url) choices.push({ uri: originalCover.url, path: originalCover.path })
    for (const im of release?.images ?? [])
      if (im.uri !== originalCover.url) choices.push({ uri: im.uri })
    return choices
  }, [release, originalCover])

  // Switches the cover among the picker's choices (the original plus the release's
  // images). It only swaps the artwork, leaving the rest of the metadata untouched.
  function pickCoverImage(delta: number): void {
    const i = stepImageIndex(coverChoices, item.coverUrl, delta)
    if (i >= 0)
      onChange({
        coverUrl: coverChoices[i].uri,
        coverPath: coverChoices[i].path,
        coverRemoved: false,
      })
  }

  function onCoverExport(): void {
    if (!item.coverUrl) return
    void window.api.exportCover({
      name: item.outputName ?? item.fileName,
      ...coverSourceOf(item),
    })
  }

  return (
    // Dragging an image is a pointer-only convenience; artwork is also set from a Discogs release.
    // biome-ignore lint/a11y/noStaticElementInteractions: drop target, not a control
    <div
      data-testid="cover-dropzone"
      onMouseEnter={() => {
        hoverRef.current = true
      }}
      onMouseLeave={() => {
        hoverRef.current = false
      }}
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setCoverDragging(true)
      }}
      onDragLeave={(e) => {
        e.stopPropagation()
        setCoverDragging(false)
      }}
      onDrop={onCoverDrop}
      className="shrink-0 self-start"
    >
      <input
        ref={coverInputRef}
        type="file"
        accept="image/*"
        data-testid="cover-input"
        className="hidden"
        onChange={(e) => {
          applyImageFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      {displayCover ? (
        <div className="group relative w-40">
          {/* The button opens the artwork big; the img inside keeps its own drag-out
              gesture (an actual drag suppresses the click, so the two don't fight). */}
          <button
            type="button"
            data-testid="cover-zoom"
            onClick={() => setLightboxOpen(true)}
            aria-label={tr('editor.coverView')}
            className="block cursor-zoom-in"
          >
            <img
              data-testid="cover-preview"
              src={displayCover}
              alt={tr('editor.coverAlt')}
              draggable={!isMulti}
              onLoad={(e) =>
                setCoverDims({
                  w: e.currentTarget.naturalWidth,
                  h: e.currentTarget.naturalHeight,
                })
              }
              onDragStart={(e) => {
                if (isMulti || !coverDragPath.current) return
                e.preventDefault()
                window.api.startCoverDrag(coverDragPath.current)
              }}
              className={`h-40 w-40 rounded-xl object-cover outline outline-1 -outline-offset-1 outline-white/10 ${
                coverDragging ? 'ring-2 ring-[var(--color-accent)]' : ''
              }`}
            />
          </button>
          {coverActions}
        </div>
      ) : (
        <div className="group relative w-40">
          <button
            type="button"
            data-testid="cover-pick"
            onClick={() => coverInputRef.current?.click()}
            className={`flex h-40 w-40 flex-col items-center justify-center gap-2 rounded-xl bg-[var(--color-field)] p-2 text-center text-xs outline outline-1 -outline-offset-1 transition-colors ${
              coverDragging
                ? 'text-[var(--color-accent)] outline-[var(--color-accent)]'
                : 'text-fg-faint outline-white/10 hover:text-fg-dim'
            }`}
          >
            <ImageIcon className="h-7 w-7" strokeWidth={1.5} aria-hidden="true" />
            {coverDragging ? tr('editor.coverDropActive') : tr('editor.coverDrop')}
          </button>
          {coverActions}
        </div>
      )}
      {!isMulti && coverChoices.length > 1 && (
        <div
          data-testid="cover-image-picker"
          className="mt-1.5 flex items-center justify-center gap-2"
        >
          <button
            type="button"
            data-testid="cover-prev"
            aria-label={tr('editor.coverPrev')}
            onClick={() => pickCoverImage(-1)}
            className="press flex h-6 w-6 items-center justify-center rounded-md text-fg-dim hover:bg-[var(--color-panel-2)] hover:text-fg"
          >
            <ChevronLeft className="h-3 w-3" aria-hidden="true" />
          </button>
          <span data-testid="cover-image-count" className="text-[11px] tabular-nums text-fg-dim">
            {(() => {
              const pos = coverChoices.findIndex((c) => c.uri === item.coverUrl) + 1
              // 0 (not '–') when no cover is selected, e.g. just after deleting one: the
              // arrows still step into the choices, so "0/4" reads as "none of 4 picked".
              return `${pos}/${coverChoices.length}`
            })()}
          </span>
          <button
            type="button"
            data-testid="cover-next"
            aria-label={tr('editor.coverNext')}
            onClick={() => pickCoverImage(1)}
            className="press flex h-6 w-6 items-center justify-center rounded-md text-fg-dim hover:bg-[var(--color-panel-2)] hover:text-fg"
          >
            <ChevronRight className="h-3 w-3" aria-hidden="true" />
          </button>
        </div>
      )}
      {lightboxOpen && displayCover && (
        <CoverLightbox
          src={displayCover}
          // Mirrors coverSourceOf: only when the shown cover is the file's own
          // embedded thumbnail does the audio file hold a better original.
          fullResFrom={!isMulti && displayCover === item.embeddedCover ? item.inputPath : undefined}
          // Same gate and stepper as the well's inline arrows, so the lightbox can
          // browse the file's art and the release's images and close on whichever.
          nav={
            !isMulti && coverChoices.length > 1
              ? {
                  position: coverChoices.findIndex((c) => c.uri === item.coverUrl) + 1,
                  count: coverChoices.length,
                  onStep: pickCoverImage,
                }
              : undefined
          }
          onClose={() => setLightboxOpen(false)}
        />
      )}
      {displayCover && coverDims && (
        <div
          data-testid="cover-resolution"
          className="mt-1.5 flex items-center justify-center gap-1.5 text-[11px]"
        >
          <span
            data-testid="cover-quality-dot"
            data-lowres={isLowResCover(coverDims.w, coverDims.h)}
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
              isLowResCover(coverDims.w, coverDims.h) ? 'bg-warn' : 'bg-good'
            }`}
          />
          <span className="tabular-nums text-fg-dim">
            {coverDims.w} × {coverDims.h} px
          </span>
        </div>
      )}
    </div>
  )
}
