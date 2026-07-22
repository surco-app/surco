import type React from 'react'
import { useTranslation } from 'react-i18next'

// The output-folder row (readonly path + Change), shared by Settings and the onboarding
// wizard as the folder detail under the destination radio. It owns the pick dialog too:
// both surfaces once reimplemented the same pickOutputDir round-trip beside their copy
// of this markup.
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
  return (
    <div className="flex gap-2">
      <input
        id={testid}
        data-testid={testid}
        aria-label={tr('settings.outputDir')}
        value={value}
        readOnly
        className="min-w-0 flex-1 truncate rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-3 py-2 text-sm text-fg-muted"
      />
      <button
        type="button"
        data-testid={`${testid}-change`}
        onClick={() => void change()}
        className="press rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] px-3 py-2 text-sm hover:bg-[var(--color-line-strong)]"
      >
        {tr('common.change')}
      </button>
    </div>
  )
}
