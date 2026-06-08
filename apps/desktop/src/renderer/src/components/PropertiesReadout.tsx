import { Folder } from 'lucide-react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { TrackProperties } from '../../../shared/types'
import { formatTime } from '../lib/duration'
import { formatFileSize } from '../lib/properties'
import { formatKHz } from '../lib/quality'

interface Props {
  properties: TrackProperties
  fileName: string
  inputPath: string
  duration: number | undefined
}

type PropRow = { id: string; label: string; value: string; full?: string }

// The technical facts ffprobe reads off the source, formatted for a human (kHz, Bit,
// kbps, MB) and grouped into Audio / File so a DJ can vet a rip. Each row drops out
// when its value is empty rather than printing a blank line.
export function PropertiesReadout({
  properties: p,
  fileName,
  inputPath,
  duration,
}: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const ext = fileName.includes('.') ? (fileName.split('.').pop() ?? '').toUpperCase() : ''
  // Show only the containing folder's name (the full path lives in the tooltip) so the
  // long absolute path doesn't blow out the row.
  const folderName =
    inputPath
      .slice(0, Math.max(inputPath.lastIndexOf('/'), inputPath.lastIndexOf('\\')))
      .split(/[/\\]/)
      .pop() || inputPath
  const modeKey = p.channels <= 1 ? 'Mono' : p.channels === 2 ? 'Stereo' : 'Multi'
  const fmtDate = (ms: number | null): string =>
    ms === null
      ? ''
      : new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  const row = (id: string, label: string, value: string, full?: string): PropRow | false =>
    value ? { id, label, value, full } : false
  const isRow = (r: PropRow | false): r is PropRow => r !== false
  const groups = [
    {
      id: 'audio',
      label: tr('editor.propertiesGroupAudio'),
      rows: [
        row('kind', tr('editor.propKind'), p.container.toUpperCase()),
        row('codec', tr('editor.propCodec'), p.codec),
        row(
          'sampleRate',
          tr('editor.propSampleRate'),
          p.sampleRateHz ? formatKHz(p.sampleRateHz) : '',
        ),
        row(
          'bitDepth',
          tr('editor.propBitDepth'),
          p.bitDepth !== null ? tr('editor.propBitDepthValue', { bits: p.bitDepth }) : '',
        ),
        row('channels', tr('editor.propChannels'), p.channels ? String(p.channels) : ''),
        row(
          'channelMode',
          tr('editor.propChannelMode'),
          p.channels ? tr(`editor.channelMode${modeKey}`) : '',
        ),
        row(
          'bitrate',
          tr('editor.propBitrate'),
          p.bitrateKbps !== null ? tr('editor.propBitrateValue', { kbps: p.bitrateKbps }) : '',
        ),
        row(
          'duration',
          tr('editor.propDuration'),
          duration !== undefined ? formatTime(duration) : '',
        ),
        row('tagFormats', tr('editor.propTagFormats'), p.tagFormats.join(', ')),
      ].filter(isRow),
    },
    {
      id: 'file',
      label: tr('editor.propertiesGroupFile'),
      rows: [
        row('fileName', tr('editor.propFileName'), fileName),
        row('extension', tr('editor.propExtension'), ext),
        row('path', tr('editor.propPath'), folderName, inputPath),
        row('size', tr('editor.propSize'), formatFileSize(p.sizeBytes)),
        row('created', tr('editor.propCreated'), fmtDate(p.createdMs)),
        row('modified', tr('editor.propModified'), fmtDate(p.modifiedMs)),
      ].filter(isRow),
    },
  ].filter((g) => g.rows.length > 0)
  return (
    <div data-testid="properties-readout" className="mt-3 space-y-3">
      {groups.map((group) => (
        <div key={group.id}>
          <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-fg-dim">
            {group.label}
          </div>
          <dl className="overflow-hidden rounded-lg bg-[var(--color-field)]">
            {group.rows.map((r, i) => (
              <div
                key={r.id}
                data-testid={`property-${r.id}`}
                className={`flex items-center justify-between gap-4 px-3 py-2 ${
                  i > 0 ? 'border-t border-[var(--color-line)]' : ''
                }`}
              >
                <dt className="shrink-0 text-xs text-fg-dim">{r.label}</dt>
                <dd className="min-w-0 truncate text-right text-sm font-medium tabular-nums">
                  {r.id === 'path' ? (
                    <button
                      type="button"
                      data-testid="property-reveal"
                      onClick={() => window.api.reveal(inputPath)}
                      title={r.full}
                      className="press inline-flex max-w-full items-center gap-1.5 align-middle text-[var(--color-accent)] hover:underline"
                    >
                      <Folder className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span className="truncate">{r.value}</span>
                    </button>
                  ) : (
                    <span title={r.full}>{r.value}</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  )
}
