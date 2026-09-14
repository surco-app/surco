import type React from 'react'
import { useTranslation } from 'react-i18next'
import { PathField } from './PathField'

// The output-folder row, shared by Settings and the onboarding wizard as the folder detail
// under the destination radio. It owns the pick dialog: both surfaces once reimplemented
// the same pickOutputDir round-trip beside their copy of this markup.
//
// The field itself is PathField, so this reads as one control like the two collection
// pickers rather than an input with a button floating beside it.
export function OutputFolderField({
  value,
  onChange,
  testid,
}: {
  value: string
  onChange: (dir: string) => void
  testid: string
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  async function change(): Promise<void> {
    const dir = await window.api.pickOutputDir()
    if (dir) onChange(dir)
  }
  // The field hangs under the destination radio with no label of its own, so its only
  // accessible name is this one.
  return (
    <PathField
      value={value}
      onChange={() => void change()}
      testid={testid}
      ariaLabel={tr('settings.outputDir')}
    />
  )
}
