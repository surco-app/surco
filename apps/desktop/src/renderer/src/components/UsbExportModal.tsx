import { Usb } from 'lucide-react'
import type React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  SourceNode,
  UsbExportRequest,
  UsbRemembered,
  UsbStartResult,
  UsbTarget,
  UsbVolume,
  UsbVolumeList,
  UsbWarning,
} from '../../../shared/types'
import { useUsbPlan } from '../hooks/useUsbPlan'
import { formatFileSize } from '../lib/properties'
import { holderText } from '../lib/usbExport'
import { type UsbExportStore, usbExportStore, useUsbExportState } from '../lib/usbExportStore'
import { CheckTree } from './CheckTree'
import { ModalShell } from './ModalShell'
import { UsbExportProgress } from './UsbExportProgress'

// The first stick to offer: the one asked for (the connect notice), else the last one used
// if it is mounted, else the only one.
function initialVolume(list: UsbVolumeList | null, preselect: string | null): UsbVolume | null {
  const vols = list?.volumes ?? []
  return (
    vols.find((v) => v.uuid === preselect) ??
    vols.find((v) => `volume:${v.uuid}` === list?.lastKey) ??
    (vols.length === 1 ? vols[0] : null)
  )
}

// What a stick starts with ticked: what its playlists3.sync lists, since rekordbox may have
// synced more playlists to it after Surco last wrote it, else what Surco remembers.
const tickedFor = (v: UsbVolume | null): string[] | null =>
  v?.stickPlaylists ?? v?.remembered?.playlistIds ?? null

// What main refuses to export anyway: Exportar is not offered while one of these shows.
const BLOCKING: ReadonlySet<UsbWarning['kind']> = new Set([
  'noSpace',
  'sourcesUnreachable',
  'emptyPlaylist',
])

export function UsbExportModal({
  nodes,
  volumes,
  preselect,
  onStart,
  onCancelExport,
  onClose,
  store = usbExportStore,
}: {
  nodes: SourceNode[] | undefined
  volumes: UsbVolumeList | null
  preselect: string | null
  onStart: (req: UsbExportRequest) => Promise<UsbStartResult>
  onCancelExport: () => void
  onClose: () => void
  store?: UsbExportStore
}): React.JSX.Element {
  const { t: tr, i18n } = useTranslation()
  const size = (bytes: number): string => formatFileSize(bytes, i18n.language)
  const phase = useUsbExportState((s) => s.phase, store)
  const targetName = useUsbExportState((s) => s.targetName, store)
  const first = initialVolume(volumes, preselect)
  const [target, setTarget] = useState<UsbTarget | null>(
    first ? { kind: 'volume', uuid: first.uuid } : null,
  )
  const [checked, setChecked] = useState<Set<string>>(new Set(tickedFor(first) ?? []))
  const [prune, setPrune] = useState(first?.remembered?.prune ?? false)
  const [settings, setSettings] = useState(first?.remembered?.settings ?? false)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  // Each stick keeps its own boxes: one Surco never wrote starts with both off, whatever
  // the previous stick had. The ticked playlists stay when the new one has none to offer.
  const seed = (ticked: string[] | null, r: UsbRemembered | null): void => {
    if (ticked) setChecked(new Set(ticked))
    setPrune(r?.prune ?? false)
    setSettings(r?.settings ?? false)
  }
  // A list that arrives after the modal opened still preselects, once.
  const [seeded, setSeeded] = useState(first !== null)
  if (!seeded && first) {
    setSeeded(true)
    setTarget({ kind: 'volume', uuid: first.uuid })
    seed(tickedFor(first), first.remembered)
  }
  const folder = target?.kind === 'folder'
  // Sorted, so the plan's settle key does not change with the order of the ticks.
  const req: UsbExportRequest | null =
    target && checked.size > 0
      ? { playlistIds: [...checked].sort(), target, prune: folder ? false : prune, settings }
      : null
  const { plan, failure, loading } = useUsbPlan(req)
  const chosen =
    target?.kind === 'volume'
      ? (volumes?.volumes.find((v) => v.uuid === target.uuid) ?? null)
      : null

  const choose = (v: UsbVolume): void => {
    setTarget({ kind: 'volume', uuid: v.uuid })
    seed(tickedFor(v), v.remembered)
  }
  // A folder has no sync file to read: only what Surco remembers for it.
  const pickFolder = async (): Promise<void> => {
    const pick = await window.api.usbPickFolder()
    if (!pick) return
    setTarget({ kind: 'folder', path: pick.path })
    seed(pick.remembered?.playlistIds ?? null, pick.remembered)
  }
  const blocked = plan?.warnings.some((w) => BLOCKING.has(w.kind)) ?? false
  const start = (): void => {
    if (!req || starting) return
    setStarting(true)
    setStartError(null)
    void onStart(req).then((r) => {
      setStarting(false)
      if (r.ok) return
      setStartError(
        r.reason === 'no-space' && r.neededBytes !== undefined && r.freeBytes !== undefined
          ? tr('usbExport.warnings.noSpace', {
              needed: size(r.neededBytes),
              free: size(r.freeBytes),
            })
          : tr(`usbExport.errors.${r.reason}`),
      )
    })
  }

  const warning = (w: UsbWarning): React.ReactNode => {
    switch (w.kind) {
      case 'cdj2000':
        return (
          <details>
            <summary>{tr('usbExport.warnings.cdj2000', { count: w.titles.length })}</summary>
            <ul className="mt-1 list-disc pl-5">
              {w.titles.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </details>
        )
      case 'unexportable':
        return (
          <details>
            <summary>{tr('usbExport.warnings.unexportable', { count: w.tracks.length })}</summary>
            <ul className="mt-1 list-disc pl-5">
              {w.tracks.map((t) => (
                <li key={`${t.title}-${t.reason}`}>
                  {`${t.title} · ${tr(`usbExport.unexportable.${t.reason}`)}`}
                </li>
              ))}
            </ul>
          </details>
        )
      case 'noSpace':
        return tr('usbExport.warnings.noSpace', {
          needed: size(w.neededBytes),
          free: size(w.freeBytes),
        })
      case 'sourcesUnreachable':
        return tr('usbExport.warnings.sourcesUnreachable', { volume: w.volume, count: w.tracks })
      case 'emptyPlaylist':
        return tr('usbExport.warnings.emptyPlaylist', { names: w.names.join(', ') })
      default:
        return tr(`usbExport.warnings.${w.kind}`)
    }
  }

  return (
    <ModalShell
      onClose={onClose}
      backdropTestId="usb-export-backdrop"
      dialogTestId="usb-export-modal"
      labelledBy="usb-export-title"
      className="flex w-[760px] max-w-[94vw] flex-col rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-panel)] shadow-[var(--shadow-float)]"
    >
      <h2
        id="usb-export-title"
        className="flex items-center gap-2 px-4 pt-4 text-base font-semibold"
      >
        <Usb size={16} aria-hidden="true" />
        {tr('usbExport.title')}
      </h2>
      {phase !== 'idle' ? (
        <UsbExportProgress
          store={store}
          footer={{
            name: targetName,
            freeBytes: chosen?.freeBytes ?? null,
            filesystem: chosen?.filesystem ?? null,
          }}
          onBackground={onClose}
          onCancel={onCancelExport}
          onClose={onClose}
        />
      ) : (
        <div
          className="grid min-h-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4 p-4"
          style={{ height: '62vh' }}
        >
          <CheckTree nodes={nodes ?? []} checked={checked} onChange={setChecked} />
          <div className="flex min-h-0 flex-col gap-3">
            <div
              role="radiogroup"
              aria-label={tr('usbExport.choose.sticks')}
              className="flex flex-col gap-1.5"
            >
              {(volumes?.volumes ?? []).length === 0 && (
                <p
                  data-testid="usb-none"
                  className="rounded-md border border-dashed border-[var(--color-line-strong)] px-3 py-4 text-center text-sm text-fg-muted"
                >
                  {tr('usbExport.choose.none')}
                </p>
              )}
              {(volumes?.volumes ?? []).map((v) => {
                const on = target?.kind === 'volume' && target.uuid === v.uuid
                return (
                  <label
                    key={v.uuid}
                    data-testid={`usb-volume-${v.uuid}`}
                    className={`flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm ${on ? 'border-[var(--color-accent)]' : 'border-[var(--color-line)] hover:bg-[var(--color-hover)]'}`}
                  >
                    <input
                      type="radio"
                      name="usb-volume"
                      data-testid={`usb-volume-pick-${v.uuid}`}
                      checked={on}
                      onChange={() => choose(v)}
                      className="mt-1 h-3.5 w-3.5 shrink-0 accent-[var(--color-accent)]"
                    />
                    <span className="min-w-0">
                      <span className="font-semibold">{v.name}</span>
                      <span className="block text-xs text-fg-muted">
                        {[
                          tr('usbExport.choose.capacity', {
                            total: size(v.totalBytes),
                            free: size(v.freeBytes),
                          }),
                          tr(`usbExport.fs.${v.filesystem}`),
                        ].join(' · ')}
                      </span>
                      <span className="block text-xs text-fg-faint">
                        {holderText(v.holder, tr, new Date())}
                      </span>
                    </span>
                  </label>
                )
              })}
              <button
                type="button"
                data-testid="usb-other"
                onClick={() => void pickFolder()}
                className="self-start text-xs text-[var(--color-accent)] hover:underline"
              >
                {target?.kind === 'folder' ? target.path : tr('usbExport.choose.other')}
              </button>
            </div>
            <div
              data-testid="usb-summary"
              role="status"
              className="min-h-0 flex-1 overflow-y-auto text-sm"
            >
              {!req && <p className="text-fg-faint">{tr('usbExport.choose.pick')}</p>}
              {req && loading && (
                <p className="text-fg-faint">{tr('usbExport.choose.calculating')}</p>
              )}
              {req && !loading && failure && (
                <p className="text-danger">{tr(`usbExport.errors.${failure}`)}</p>
              )}
              {req && !loading && plan && (
                <>
                  <p className="font-semibold">
                    {tr('usbExport.summary.tracks', { count: plan.trackCount })}
                  </p>
                  <p>
                    {tr('usbExport.summary.new', {
                      count: plan.newCount,
                      size: size(plan.newBytes),
                    })}
                  </p>
                  <p>{tr('usbExport.summary.kept', { count: plan.keptCount })}</p>
                  {plan.removedSinceLast !== null && plan.removedSinceLast > 0 && (
                    <p>{tr('usbExport.summary.removed', { count: plan.removedSinceLast })}</p>
                  )}
                  <ul className="mt-2 flex flex-col gap-1 text-xs text-fg-muted">
                    {plan.warnings.map((w) => (
                      <li
                        key={w.kind}
                        data-testid={`usb-warning-${w.kind}`}
                        className={BLOCKING.has(w.kind) ? 'text-danger' : undefined}
                      >
                        {warning(w)}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                data-testid="usb-settings"
                checked={settings}
                onChange={(e) => setSettings(e.target.checked)}
              />
              {tr('usbExport.choose.settings')}
            </label>
            {!folder && (
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  data-testid="usb-prune"
                  checked={prune}
                  onChange={(e) => setPrune(e.target.checked)}
                />
                {tr('usbExport.choose.prune')}
              </label>
            )}
            {startError && (
              <p data-testid="usb-start-error" role="alert" className="text-xs text-danger">
                {startError}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                data-testid="usb-cancel-choose"
                onClick={onClose}
                className="rounded-md px-3 py-1.5 text-sm hover:bg-[var(--color-hover)]"
              >
                {tr('usbExport.choose.cancel')}
              </button>
              <button
                type="button"
                data-testid="usb-export"
                disabled={!req || !plan || loading || blocked || starting}
                onClick={start}
                className="rounded-md bg-[var(--color-accent)] px-4 py-1.5 text-sm text-[var(--color-on-accent)] disabled:opacity-40"
              >
                {tr('usbExport.choose.export')}
              </button>
            </div>
          </div>
        </div>
      )}
    </ModalShell>
  )
}
