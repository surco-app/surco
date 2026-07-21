import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { SyncedDraft } from '../../lib/settingsDraft'
import type { PatchSynced } from '../../lib/settingsTabs'
import { DeclickControls } from '../DeclickControls'
import { NormalizeControls } from '../NormalizeControls'
import { SettingsHint, SettingsLabel, SettingsSection } from './SettingsPrimitives'

interface Props {
  synced: SyncedDraft
  patch: PatchSynced
}

// The audio the conversion applies before writing the file: click repair, then loudness
// normalization. Split from the Format tab (which defines the container/encoder) so each
// has room — the order here matches the order the pipeline runs them in.
export function ProcessingTab({ synced, patch }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  return (
    <>
      <SettingsSection first>
        <SettingsLabel>{tr('declick.title')}</SettingsLabel>
        <SettingsHint className="mt-2 mb-3">{tr('declick.hint')}</SettingsHint>
        <DeclickControls value={synced.declick} onChange={(d) => patch('declick', d)} />
      </SettingsSection>

      <SettingsSection>
        <SettingsLabel>{tr('normalize.title')}</SettingsLabel>
        <SettingsHint className="mt-2 mb-3">{tr('normalize.hint')}</SettingsHint>
        <NormalizeControls value={synced.normalize} onChange={(n) => patch('normalize', n)} />
      </SettingsSection>
    </>
  )
}
