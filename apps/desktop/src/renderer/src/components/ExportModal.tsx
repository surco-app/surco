import type React from 'react'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { buildRekordboxXml } from '../lib/rekordbox'
import { buildTraktorNml } from '../lib/traktor'
import type { TrackItem } from '../types'
import { useFocusTrap } from './useFocusTrap'

interface Props {
  tracks: TrackItem[]
  onClose: () => void
}

// One "Export" entry point instead of a button per DJ app: picks the target collection
// file (rekordbox .xml / Traktor .nml) and writes it via the matching IPC. Both are
// import bridges — the user points their software at the saved file. Serato etc. slot
// in here later as new rows.
export function ExportModal({ tracks, onClose }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const dialogRef = useRef<HTMLDivElement>(null)
  useFocusTrap(dialogRef)

  const targets = [
    {
      id: 'rekordbox',
      label: 'rekordbox',
      ext: '.xml',
      hint: tr('export.rekordboxHint'),
      run: () => window.api.exportRekordbox(buildRekordboxXml(tracks)),
    },
    {
      id: 'traktor',
      label: 'Traktor',
      ext: '.nml',
      hint: tr('export.traktorHint'),
      run: () => window.api.exportTraktor(buildTraktorNml(tracks)),
    },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button
        type="button"
        data-testid="export-backdrop"
        aria-label={tr('common.close')}
        onClick={onClose}
        className="animate-overlay absolute inset-0 bg-black/60 backdrop-blur-sm"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        className="animate-pop relative z-10 w-[440px] rounded-2xl border border-[var(--color-line-strong)] bg-[var(--color-panel)] p-6"
      >
        <h2 className="text-base font-semibold">{tr('export.title')}</h2>
        <p className="mt-1 text-sm text-fg-dim">{tr('export.subtitle')}</p>
        <div className="mt-4 flex flex-col gap-2">
          {targets.map((t) => (
            <button
              key={t.id}
              type="button"
              data-testid={`export-${t.id}`}
              onClick={() => {
                void t.run()
                onClose()
              }}
              className="press block rounded-lg border border-[var(--color-line)] px-4 py-3 text-left hover:bg-[var(--color-panel-2)]"
            >
              <span className="flex items-center justify-between">
                <span className="text-sm font-medium">{t.label}</span>
                <span className="text-xs tabular-nums text-fg-dim">{t.ext}</span>
              </span>
              <span className="mt-1 block text-xs text-fg-dim">{t.hint}</span>
            </button>
          ))}
        </div>
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            data-testid="export-cancel"
            onClick={onClose}
            className="press rounded-lg border border-[var(--color-line-strong)] px-4 py-2 text-sm font-medium hover:bg-[var(--color-panel-2)]"
          >
            {tr('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}
