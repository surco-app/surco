import { Check, Clock, Loader2, ShieldAlert, ShieldCheck, TriangleAlert } from 'lucide-react'
import type React from 'react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { type CheckDetail, PLACE_ORDER, type PlaceCheck } from '../../../shared/verification'
import { formatUpTo } from '../lib/numberFormat'
import { type MenuPlacement, placeMenu, useCloseOnMove } from './menuPlacement'
import { useSplitMenu } from './SplitButton'
import { Tooltip } from './Tooltip'

// The few details whose params need the UI language before they read: a rate in the
// language's decimal mark, the playlists as a spoken list, a cue count that picks its plural,
// a field by the label the form gives it.
export function detailText(
  { key, params = {} }: CheckDetail,
  tr: (key: string, options?: Record<string, unknown>) => string,
  language: string,
): string {
  if (key === 'fileReencoded') {
    const rate = formatUpTo(Number(params.rate) / 1000, 1, language)
    return Number(params.bits) > 0
      ? tr('verify.detail.fileReencoded', { ...params, rate })
      : tr('verify.detail.fileReencodedLossy', { ...params, rate })
  }
  if (key === 'musicOne') {
    const names = Array.isArray(params.playlists) ? params.playlists : []
    const playlists = new Intl.ListFormat(language, { type: 'conjunction' }).format(names)
    return tr('verify.detail.musicOne', { playlists })
  }
  if (key === 'rekordboxOk')
    return tr('verify.detail.rekordboxOk', { ...params, count: params.cues })
  if (key === 'fileTagDiffers' || key === 'musicTagDiffers')
    return tr(`verify.detail.${key}`, { field: tr(`fields.${params.field}`) })
  if (key === 'enginePerformanceChanged')
    return tr('verify.detail.enginePerformanceChanged', {
      field: tr(`verify.engineField.${params.field}`),
    })
  if (key === 'rekordboxCuesLost' || key === 'rekordboxCuesChanged')
    return tr(`verify.detail.${key}`, { ...params, count: params.before })
  if (key === 'fileSourceGone')
    return Number(params.kept)
      ? tr('verify.detail.fileSourceGoneKept', { panel: tr('copies.rail') })
      : tr('verify.detail.fileSourceGone')
  return tr(`verify.detail.${key}`, params)
}

// The shield beside the done line: what Surco re-read after the conversion, one line per
// place it touched, in the order the work happened. Places it never wrote to never show.
// A place that did not add up (or could not be read) is marked in amber, never checked.
export function VerifiedPopover({ checks }: { checks: PlaceCheck[] }): React.JSX.Element {
  const { t: tr, i18n } = useTranslation()
  const { open, setOpen, ref, toggleRef, menuRef, onMenuKeyDown } = useSplitMenu()
  const [pos, setPos] = useState<MenuPlacement | null>(null)
  useCloseOnMove(open, menuRef, setOpen)
  useEffect(() => {
    if (open) menuRef.current?.focus()
  }, [open, menuRef])
  const lines = [...checks].sort(
    (a, b) => PLACE_ORDER.indexOf(a.place) - PLACE_ORDER.indexOf(b.place),
  )
  const label = tr('verify.shieldLabel')
  const failed = (c: PlaceCheck) => c.state === 'mismatch' || c.state === 'unreadable'
  const Shield = checks.some(failed) ? ShieldAlert : ShieldCheck

  return (
    <div ref={ref} className="shrink-0">
      <button
        type="button"
        data-testid="verify-shield"
        ref={toggleRef}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          const r = toggleRef.current?.getBoundingClientRect()
          if (!open && r) setPos(placeMenu(r, 'start'))
          setOpen((v) => !v)
        }}
        className="press relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-fg-dim hover:bg-[var(--color-hover)] hover:text-fg aria-expanded:text-[var(--color-accent)]"
      >
        <Shield className="h-3.5 w-3.5" aria-hidden="true" />
        {!open && <Tooltip label={label} />}
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            role="dialog"
            data-testid="verify-popover"
            aria-label={tr('verify.title')}
            tabIndex={-1}
            onKeyDown={onMenuKeyDown}
            style={{ top: pos.top, bottom: pos.bottom, left: pos.left, maxHeight: pos.maxHeight }}
            className={`animate-pop-flat fixed z-50 w-72 max-w-[calc(100vw-16px)] overflow-y-auto ${pos.bottom !== undefined ? 'origin-bottom-left' : 'origin-top-left'} rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel)] py-1 shadow-[var(--shadow-float)] outline-none`}
          >
            <p className="px-3 pt-1.5 pb-1 text-[11px] font-medium text-fg-dim">
              {tr('verify.title')}
            </p>
            <ul>
              {lines.map((c) => (
                <li
                  key={c.place}
                  data-testid="verify-line"
                  data-place={c.place}
                  className="flex items-start gap-2 px-3 py-1.5 text-xs"
                >
                  {failed(c) ? (
                    <TriangleAlert
                      data-testid="verify-line-mismatch"
                      className="mt-px h-3.5 w-3.5 shrink-0 text-warn"
                      aria-hidden="true"
                    />
                  ) : c.state === 'checking' ? (
                    <Loader2
                      className="mt-px h-3.5 w-3.5 shrink-0 animate-spin text-fg-dim"
                      aria-hidden="true"
                    />
                  ) : c.state === 'pending' ? (
                    <Clock
                      data-testid="verify-line-pending"
                      className="mt-px h-3.5 w-3.5 shrink-0 text-fg-dim"
                      aria-hidden="true"
                    />
                  ) : (
                    <Check
                      className="mt-px h-3.5 w-3.5 shrink-0 text-good"
                      strokeWidth={2.5}
                      aria-hidden="true"
                    />
                  )}
                  <div className="min-w-0">
                    <p className="font-medium text-fg">{tr(`verify.places.${c.place}`)}</p>
                    <p className="text-fg-dim">{detailText(c.detail, tr, i18n.language)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>,
          document.body,
        )}
    </div>
  )
}
