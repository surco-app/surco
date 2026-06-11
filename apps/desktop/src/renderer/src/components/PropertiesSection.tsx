import type React from 'react'
import { useTranslation } from 'react-i18next'
import { useTrackProperties } from '../hooks/useTrackProperties'
import type { TrackItem } from '../types'
import { PropertiesReadout } from './PropertiesReadout'
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
  const { data: properties, isError: propertiesError } = useTrackProperties(item.inputPath, true)
  return (
    <div className="mt-6 border-t border-[var(--color-line)] pt-5">
      <SectionHeader title={tr('editor.propertiesTitle')} open={open} onToggle={onToggle} />
      {open &&
        (properties ? (
          <PropertiesReadout
            properties={properties}
            fileName={item.fileName}
            inputPath={item.inputPath}
            duration={item.duration}
          />
        ) : (
          (properties === null || propertiesError) && (
            <p className="mt-3 text-xs text-fg-dim">{tr('editor.propertiesUnavailable')}</p>
          )
        ))}
    </div>
  )
}
