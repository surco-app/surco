import type React from 'react'
import { useTranslation } from 'react-i18next'
import { useTrackProperties } from '../hooks/useTrackProperties'
import { formatFileSize } from '../lib/properties'
import { formatKHz } from '../lib/quality'
import type { TrackItem } from '../types'
import { PropertiesReadout } from './PropertiesReadout'
import { PropertiesSkeleton } from './PropertiesSkeleton'
import { SectionBody } from './SectionBody'
import { SectionHeader } from './SectionHeader'

interface Props {
  item: TrackItem
  open: boolean
  onToggle: () => void
}

// Read-only technical facts for the shown track. Owns its own probe: keyed by input
// path, so it measures once per file and reads the right facts on a track switch; the
// editor only mounts this in single-track mode, where there is one source to inspect.
// A failed probe renders as "unavailable".
export function PropertiesSection({ item, open, onToggle }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  // Probe regardless of fold state: the header itself shows a one-line digest of the
  // facts (container · kHz · bit · mode · size), so a folded panel still needs them.
  // The query is cached per path, so this is one cheap probe per file either way.
  const { data: properties, isError: propertiesError } = useTrackProperties(item.inputPath, true)
  // A glanceable digest of the rip's shape; each part drops out when the probe could
  // not read it, so a lossy file just shows fewer fields rather than blanks.
  const summary = properties
    ? [
        properties.container.toUpperCase(),
        properties.sampleRateHz ? formatKHz(properties.sampleRateHz) : '',
        properties.bitDepth !== null
          ? tr('editor.propBitDepthValue', { bits: properties.bitDepth })
          : '',
        properties.channels
          ? tr(
              `editor.channelMode${properties.channels <= 1 ? 'Mono' : properties.channels === 2 ? 'Stereo' : 'Multi'}`,
            )
          : '',
        formatFileSize(properties.sizeBytes),
      ]
        .filter(Boolean)
        .join(' · ')
    : ''
  return (
    <div className="mt-5 border-t border-[var(--color-line)] pt-5">
      <SectionHeader
        title={tr('editor.propertiesTitle')}
        open={open}
        onToggle={onToggle}
        summary={summary || undefined}
        summaryTestId="properties-summary"
      />
      <SectionBody open={open}>
        {properties ? (
          <PropertiesReadout
            properties={properties}
            fileName={item.fileName}
            inputPath={item.inputPath}
            duration={item.duration}
          />
        ) : properties === null || propertiesError ? (
          <p className="mt-3 text-xs text-fg-dim">{tr('editor.propertiesUnavailable')}</p>
        ) : (
          // Still probing (properties === undefined): a placeholder table rather than an
          // empty open body, so a cold first open doesn't flash a blank section.
          <PropertiesSkeleton />
        )}
      </SectionBody>
    </div>
  )
}
