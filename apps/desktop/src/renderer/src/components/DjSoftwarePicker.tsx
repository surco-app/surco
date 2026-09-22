import type React from 'react'
import { useTranslation } from 'react-i18next'
import {
  type DestinationPlan,
  DJ_SOFTWARE_NAMES,
  type DjSoftware,
  keepsOutputCopy,
  withAppleMusic,
  withEngineDj,
} from '../lib/destination'
import { CheckboxRow } from './settings/CheckboxRow'

interface Props {
  plan: DestinationPlan
  onPlanChange: (plan: DestinationPlan) => void
  mac: boolean
  flac: boolean
  syncTraktor: boolean
  onSyncTraktorChange: (on: boolean) => void
  traktorAvailable: boolean
  traktorDetail: React.ReactNode
  syncRekordbox: boolean
  onSyncRekordboxChange: (on: boolean) => void
  rekordboxAvailable: boolean
  rekordboxDetail?: React.ReactNode
  engineDetail: React.ReactNode
  testidPrefix: string
}

export function DjSoftwarePicker({
  plan,
  onPlanChange,
  mac,
  flac,
  syncTraktor,
  onSyncTraktorChange,
  traktorAvailable,
  traktorDetail,
  syncRekordbox,
  onSyncRekordboxChange,
  rekordboxAvailable,
  rekordboxDetail,
  engineDetail,
  testidPrefix,
}: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const inFolder = plan.location === 'folder'
  const needsFolder = inFolder ? undefined : tr('settings.libraryNeedsFolder')
  return (
    <div className="flex flex-col gap-2">
      {mac && (
        <DjOption
          id="appleMusic"
          testid={`${testidPrefix}-dj-appleMusic`}
          checked={plan.appleMusic}
          disabled={!inFolder || flac}
          reason={needsFolder ?? (flac ? tr('settings.appleMusicFlacNote') : undefined)}
          onChange={(on) => onPlanChange(withAppleMusic(plan, on))}
        >
          <CheckboxRow
            testid={`${testidPrefix}-apple-music-copy`}
            checked={plan.appleMusic && keepsOutputCopy(plan)}
            disabled={!plan.appleMusic || plan.engineDj}
            onChange={(on) => onPlanChange({ ...plan, keepOutputCopy: on })}
            label={tr('settings.appleMusicKeepCopy')}
          />
          {plan.appleMusic && plan.engineDj && (
            <p className="mt-1.5 pl-7 text-xs leading-relaxed text-fg-dim">
              {tr('settings.appleMusicKeepCopyEngine')}
            </p>
          )}
        </DjOption>
      )}
      <DjOption
        id="engineDj"
        testid={`${testidPrefix}-dj-engineDj`}
        checked={plan.engineDj}
        disabled={!inFolder}
        reason={needsFolder}
        onChange={(on) => onPlanChange(withEngineDj(plan, on))}
      >
        {engineDetail}
      </DjOption>
      <DjOption
        id="rekordbox"
        testid={`${testidPrefix}-dj-rekordbox`}
        checked={syncRekordbox}
        disabled={!rekordboxAvailable}
        reason={rekordboxAvailable ? undefined : tr('settings.syncRekordboxIdle')}
        onChange={onSyncRekordboxChange}
      >
        {rekordboxDetail}
      </DjOption>
      <DjOption
        id="traktor"
        testid={`${testidPrefix}-dj-traktor`}
        checked={syncTraktor}
        disabled={!traktorAvailable}
        reason={traktorAvailable ? undefined : tr('settings.syncTraktorIdle')}
        onChange={onSyncTraktorChange}
      >
        {traktorDetail}
      </DjOption>
      <p className="mt-1 text-xs leading-relaxed text-fg-dim">{tr('settings.djSoftwareSafety')}</p>
    </div>
  )
}

function DjOption({
  id,
  testid,
  checked,
  disabled,
  reason,
  onChange,
  children,
}: {
  id: DjSoftware
  testid: string
  checked: boolean
  disabled: boolean
  reason?: string
  onChange: (on: boolean) => void
  children?: React.ReactNode
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  return (
    <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-3 py-2.5">
      <label
        className={`flex items-start gap-3 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <input
          data-testid={testid}
          type="checkbox"
          checked={checked && !disabled}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]"
        />
        <span className={`min-w-0 text-sm font-medium ${disabled ? 'opacity-50' : ''}`}>
          {DJ_SOFTWARE_NAMES[id]}
          <span className="mt-0.5 block text-xs font-normal text-fg-dim">
            {tr(`settings.djSoftwareDoes.${id}`)}
          </span>
        </span>
      </label>
      {reason && <p className="mt-1.5 pl-7 text-xs leading-relaxed text-warn">{reason}</p>}
      {children && <div className="mt-3 pl-7">{children}</div>}
    </div>
  )
}
