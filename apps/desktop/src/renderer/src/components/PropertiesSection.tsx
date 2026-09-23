import type React from 'react'
import { useTranslation } from 'react-i18next'
import { useTrackProperties } from '../hooks/useTrackProperties'
import { audioSummaryParts, formatFileSize } from '../lib/properties'
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
  const summary = properties
    ? [
        ...audioSummaryParts(properties, item.inputPath, tr),
        formatFileSize(properties.sizeBytes),
      ].join(' · ')
    : ''
  return (
    <div className="mt-6 border-t border-[var(--color-line)] pt-6">
      <SectionHeader
        sectionId="properties"
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
