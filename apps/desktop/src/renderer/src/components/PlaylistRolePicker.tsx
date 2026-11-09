import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { PlaylistRole } from '../../../shared/sessionTypes'

const ROLES: readonly PlaylistRole[] = ['base', 'vocal', 'any']

const CHIP = 'press rounded-full border px-2.5 py-0.5 text-xs'
const CHIP_ON =
  'border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-on-accent)]'
const CHIP_OFF =
  'border-[var(--color-line-strong)] text-fg-muted hover:bg-[var(--color-hover)] hover:text-fg'

export function PlaylistRolePicker({
  value,
  onChange,
  testIdPrefix,
  name,
}: {
  value: PlaylistRole | null
  onChange: (role: PlaylistRole | null) => void
  testIdPrefix: string
  name?: string
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  return (
    <fieldset
      aria-label={name ? tr('sessions.role.of', { name }) : tr('sessions.role.title')}
      className="flex min-w-0 flex-wrap gap-1"
    >
      {ROLES.map((role) => (
        <button
          key={role}
          type="button"
          data-testid={`${testIdPrefix}-${role}`}
          aria-pressed={value === role}
          onClick={() => onChange(value === role ? null : role)}
          className={`${CHIP} ${value === role ? CHIP_ON : CHIP_OFF}`}
        >
          {tr(`sessions.role.${role}`)}
        </button>
      ))}
    </fieldset>
  )
}
