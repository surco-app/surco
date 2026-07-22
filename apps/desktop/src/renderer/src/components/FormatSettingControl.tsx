import type React from 'react'
import { useTranslation } from 'react-i18next'
import { FORMAT_SETTINGS } from '../../../shared/outputFormats'
import type { FormatSetting } from '../../../shared/types'
import { SegmentedControl } from './SegmentedControl'

// The one Default-format picker, shared by Settings and the onboarding wizard. The
// options are baked in on purpose: the two surfaces once each held their own list, and
// 'source' shipped in Settings but never reached the wizard. With the list living here,
// a future format can't be added to one surface without the other.
export function FormatSettingControl({
  value,
  onChange,
  testidPrefix,
}: {
  value: FormatSetting
  onChange: (value: FormatSetting) => void
  testidPrefix: string
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  return (
    <SegmentedControl
      options={FORMAT_SETTINGS}
      value={value}
      onChange={onChange}
      testidPrefix={testidPrefix}
      labelFor={(id) => tr(`settings.formats.${id}`)}
    />
  )
}
