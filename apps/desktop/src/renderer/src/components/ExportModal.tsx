import type React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { buildEnginePayload } from '../lib/engine'
import { buildRekordboxXml } from '../lib/rekordbox'
import { buildSeratoCrate } from '../lib/serato'
import { buildTraktorNml } from '../lib/traktor'
import type { TrackItem } from '../types'
import { ModalShell } from './ModalShell'

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
  const [error, setError] = useState('')

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
    {
      id: 'serato',
      label: 'Serato DJ',
      ext: '.crate',
      hint: tr('export.seratoHint'),
      run: () => window.api.exportSerato(buildSeratoCrate(tracks)),
    },
    {
      id: 'engine',
      label: 'Engine DJ',
      ext: 'Engine Library',
      hint: tr('export.engineHint'),
      run: () => window.api.exportEngine(buildEnginePayload(tracks), 'Surco'),
    },
  ]

  return (
    <ModalShell
      onClose={onClose}
      backdropTestId="export-backdrop"
      labelledBy="export-title"
      className="w-[440px] rounded-2xl border border-[var(--color-line-strong)] bg-[var(--color-panel)] p-6"
    >
      <h2 id="export-title" className="text-base font-semibold">
        {tr('export.title')}
      </h2>
      <p className="mt-1 text-sm text-fg-dim">{tr('export.subtitle')}</p>
      <div className="mt-4 flex flex-col gap-2">
        {targets.map((t) => (
          <button
            key={t.id}
            type="button"
            data-testid={`export-${t.id}`}
            onClick={() => {
              // Close only once the write lands: a disk-full or permission failure
              // keeps the modal open and says so, instead of closing as if the file
              // had been written. A cancelled save dialog resolves and closes quietly.
              t.run()
                .then(onClose)
                .catch((e) => setError(e instanceof Error ? e.message : String(e)))
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
      {error && (
        <p role="alert" data-testid="export-error" className="mt-3 text-sm text-danger">
          {tr('export.failed', { error })}
        </p>
      )}
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
    </ModalShell>
  )
}
