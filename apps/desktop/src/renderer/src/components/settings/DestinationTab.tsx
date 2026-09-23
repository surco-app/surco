import { AlertTriangle } from 'lucide-react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import { BACKUP_POLICIES, type BackupPolicy } from '../../../../shared/backupPolicy'
import {
  type DestinationPlan,
  LOCATIONS,
  planFromSettings,
  planToSettings,
  withLocation,
} from '../../lib/destination'
import { isMacOS } from '../../lib/platform'
import type { LocalDraft, SyncedDraft } from '../../lib/settingsDraft'
import type { PatchSynced } from '../../lib/settingsTabs'
import { DjSoftwarePicker } from '../DjSoftwarePicker'
import { EngineLibraryFields } from '../EngineLibraryFields'
import { LocationPicker } from '../LocationPicker'
import { OutputFolderField } from '../OutputFolderField'
import { PathField } from '../PathField'
import { SegmentedControl } from '../SegmentedControl'
import { SettingsField, SettingsHint, SettingsLabel, SettingsSection } from './SettingsPrimitives'

// Apple Music automation only exists on macOS, so the destination is meaningless on
// other platforms where a track simply finishes in the output folder.
const isMac = isMacOS()

// The grey line states what each level DOES, in one register. 'never' gets a line of
// its own rather than reusing its warning text: the amber box below already carries the
// risk, and printing the same sentence twice, stacked, read as a rendering fault.
const POLICY_HINT: Record<BackupPolicy, string> = {
  always: 'settings.originalBackupAlwaysHint',
  audioChanges: 'settings.originalBackupAudioChangesHint',
  never: 'settings.originalBackupNeverLine',
}

// Half a beat at 128 BPM (234 ms) is where this stops being a cue adjustment: past it the
// cue is nearer the next beat than its own. The slider reaches further than the presets
// so a value like the reporter's 51 ms is not the edge of the range.
const CUE_MAX_MS = 120

// What the correction defaults to the moment a DJ says his cues are off. The reporter
// arrived at 51 by ear over a long session (09/09/2026); starting anywhere else would
// make the common case a hunt through the stepper.
const CUE_DEFAULT_MS = 51

// The three answers to "where do your cues land?", in the DJ's own words. The stored
// setting is still one signed number: the sign is derived here and never typed, which is
// the whole point. He got it backwards when the UI showed him a sign to reason about
// ("you put it the other way round"), so nothing in this section names one.
//
// Measured end to end through a real conversion: a cue stored at 10000 ms comes out at
// 9949 under -51 — nearer the start, so it fires EARLIER — and at 10051 under +51. So a
// DJ reporting cues that come in EARLY needs them pushed LATER, which is the positive
// sign. The mapping below reads the opposite way round to first instinct, and that
// inversion is exactly what this control exists to hide.
type CueDirection = 'none' | 'early' | 'late'

// "Mis cues entran pronto" means they need moving later: positive.
const CUE_SIGN: Record<Exclude<CueDirection, 'none'>, number> = { early: 1, late: -1 }

const CUE_CHOICES: { id: CueDirection; labelKey: string; noteKey: string }[] = [
  { id: 'none', labelKey: 'settings.traktorCueStay', noteKey: 'settings.traktorCueStayNote' },
  { id: 'early', labelKey: 'settings.traktorCueEarly', noteKey: 'settings.traktorCueEarlyNote' },
  { id: 'late', labelKey: 'settings.traktorCueLate', noteKey: 'settings.traktorCueLateNote' },
]

// A stored POSITIVE offset is the correction for cues that came in early (it pushes them
// later), so it is the 'early' answer that reads as chosen. See CUE_SIGN above.
function cueDirection(ms: number): CueDirection {
  if (!Number.isFinite(ms) || ms === 0) return 'none'
  return ms > 0 ? 'early' : 'late'
}

interface Props {
  synced: SyncedDraft
  local: LocalDraft
  patch: PatchSynced
  onOutputDirChange: (dir: string) => void
  // Takes the folder the shared field's own picker returned; the dialog lives there so
  // neither surface reimplements the round-trip.
  onChangeEngineDir: (dir: string) => void
  onChangeTraktorNmlPath: () => void
  // A candidate collection.nml autodetection found — null while unresolved or once
  // traktorNmlPath is already set (see SettingsModal). Never applied on its own; the
  // user accepts it explicitly via onAcceptDetectedNmlPath.
  detectedNmlPath: string | null
  onAcceptDetectedNmlPath: () => void
  // Where rekordbox keeps its collection on this machine, or '' when none was found.
  // Detected rather than chosen, but still changeable: a DJ whose collection lives
  // somewhere else had no way to say so.
  rekordboxCollection: string
  onChangeRekordboxDbPath: () => void
}

// What the DJ plays with and where the converted file is saved. Split from the
// Conversion tab, which keeps everything that defines the file itself — the format
// chosen there still gates the choices here (FLAC keeps Apple Music out).
export function DestinationTab({
  synced,
  local,
  patch,
  onOutputDirChange,
  onChangeEngineDir,
  onChangeTraktorNmlPath,
  detectedNmlPath,
  onAcceptDetectedNmlPath,
  rekordboxCollection,
  onChangeRekordboxDbPath,
}: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  // One signed number still drives the whole section, clamped so a value from an older
  // build cannot step out of range. The DJ never sees this sign: the choice below carries
  // the direction and the stepper only ever shows its magnitude.
  const stored = Math.max(
    -CUE_MAX_MS,
    Math.min(CUE_MAX_MS, Math.round(Number(synced.traktorCueOffsetMs)) || 0),
  )
  const direction = cueDirection(stored)
  const magnitude = Math.abs(stored)
  // 'never' dims the limits rather than hiding them: they still govern what is already
  // stored, and a control that vanishes reads as having discarded it.
  const backupOff = synced.backupPolicy === 'never'
  const plan = planFromSettings(synced, synced.outputFormat === 'flac')
  function applyPlan(next: DestinationPlan): void {
    const flags = planToSettings(next)
    patch('addToAppleMusic', flags.addToAppleMusic)
    patch('keepOutputCopy', flags.keepOutputCopy)
    patch('overwriteOriginal', flags.overwriteOriginal)
    patch('addToEngineDj', flags.addToEngineDj)
    patch('convertBesideOriginal', flags.convertBesideOriginal)
  }
  return (
    <>
      <SettingsField label={tr('settings.djSoftware')}>
        <DjSoftwarePicker
          plan={plan}
          onPlanChange={applyPlan}
          mac={isMac}
          flac={synced.outputFormat === 'flac'}
          syncTraktor={synced.syncTraktor}
          onSyncTraktorChange={(on) => patch('syncTraktor', on)}
          traktorAvailable={!!local.traktorNmlPath}
          traktorDetail={
            <>
              <PathField
                value={local.traktorNmlPath}
                onChange={onChangeTraktorNmlPath}
                testid="settings-traktor-nml"
                emptyLabel={tr('settings.traktorNmlPathEmpty')}
                ariaLabel={tr('settings.traktorNmlPath')}
              />
              {!local.traktorNmlPath && detectedNmlPath && (
                <div
                  data-testid="settings-traktor-nml-detected"
                  className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-panel-2)] px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm">{detectedNmlPath}</p>
                    <SettingsHint>{tr('settings.traktorNmlPathDetectedHint')}</SettingsHint>
                  </div>
                  <button
                    type="button"
                    data-testid="settings-traktor-nml-use-detected"
                    onClick={onAcceptDetectedNmlPath}
                    className="press shrink-0 rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] px-3 py-2 text-sm hover:bg-[var(--color-line-strong)]"
                  >
                    {tr('settings.traktorNmlPathUseDetected')}
                  </button>
                </div>
              )}
              {/* One signed row, not a question plus a size. Splitting the sign from the
                  magnitude cost four controls for one number — a question to pick the
                  direction, an unsigned row to pick the size, a slider, and a sentence to read
                  the result back — and made the least-used setting in Output the largest. A
                  button labelled "-25 ms" carries the whole decision, and "No adjustment" is
                  the middle of the row rather than an answer of its own.

                  Always rendered, never conditionally mounted: a control that appears and
                  disappears leaves the user unable to tell whether the setting exists at all.
                  Without a collection it is disabled and the hint says what is missing. */}
              <div className="mt-6">
                <SettingsLabel>{tr('settings.traktorCueOffset')}</SettingsLabel>
                <p className="mt-1 text-sm text-fg-muted">{tr('settings.traktorCueQuestion')}</p>

                {/* Radios, not a row of signed buttons: the DJ answers what he HEARS and Surco
                    derives the sign. The previous row asked him to know which way a negative
                    number moves a cue, and he guessed wrong. */}
                <div className="mt-3 flex flex-col gap-0.5">
                  {CUE_CHOICES.map(({ id, labelKey, noteKey }) => {
                    const chosen = direction === id
                    return (
                      // A real radio input rather than a button wearing the role: it brings
                      // arrow-key navigation and the group semantics for free, and the visible
                      // dot is drawn beside it with the input itself kept off-screen but
                      // focusable, so the ring still follows the keyboard.
                      <label
                        key={id}
                        className="flex cursor-pointer items-center gap-2.5 rounded-lg px-1 py-1.5 hover:bg-[var(--color-panel-2)]/30 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[var(--color-accent)]"
                      >
                        <input
                          type="radio"
                          name="settings-cue-direction"
                          data-testid={`settings-cue-dir-${id}`}
                          checked={chosen}
                          onChange={() =>
                            patch(
                              'traktorCueOffsetMs',
                              id === 'none'
                                ? '0'
                                : String(CUE_SIGN[id] * (magnitude || CUE_DEFAULT_MS)),
                            )
                          }
                          className="peer sr-only"
                        />
                        <span
                          aria-hidden="true"
                          className={`size-[15px] shrink-0 rounded-full border ${
                            chosen
                              ? 'border-[5px] border-[var(--color-accent)]'
                              : 'border-[1.5px] border-[var(--color-line-strong)]'
                          }`}
                        />
                        <span className="text-sm text-fg">
                          {tr(labelKey)}
                          <span className="text-fg-muted"> · {tr(noteKey)}</span>
                        </span>
                      </label>
                    )
                  })}
                </div>

                {/* Always the magnitude, never the stored sign: a "-51" beside a choice that
                    already says "early" is the double negative this redesign removes. Stepping
                    keeps the chosen direction, so the amount can never cross zero and flip it
                    under a DJ who was only making the correction smaller. */}
                <div className="mt-3 flex items-center gap-2 border-t border-[var(--color-line)] pt-3">
                  <span className="flex-1 text-sm text-fg-muted">
                    {tr('settings.traktorCueAmount')}
                  </span>
                  <button
                    type="button"
                    data-testid="settings-cue-amount-down"
                    aria-label={tr('settings.traktorCueAmountDown')}
                    disabled={direction === 'none' || magnitude <= 1}
                    onClick={() => patch('traktorCueOffsetMs', String(stored - Math.sign(stored)))}
                    className="press rounded-md border border-[var(--color-line-strong)] px-2.5 py-1 text-sm text-fg-muted enabled:hover:bg-[var(--color-panel-2)]/40 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    −
                  </button>
                  <span
                    data-testid="settings-cue-amount"
                    className="min-w-14 text-center text-sm tabular-nums text-fg"
                  >
                    {magnitude} ms
                  </span>
                  <button
                    type="button"
                    data-testid="settings-cue-amount-up"
                    aria-label={tr('settings.traktorCueAmountUp')}
                    disabled={direction === 'none' || magnitude >= CUE_MAX_MS}
                    onClick={() => patch('traktorCueOffsetMs', String(stored + Math.sign(stored)))}
                    className="press rounded-md border border-[var(--color-line-strong)] px-2.5 py-1 text-sm text-fg-muted enabled:hover:bg-[var(--color-panel-2)]/40 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    +
                  </button>
                </div>

                <SettingsHint className="mt-2">{tr('settings.traktorCueOffsetHint')}</SettingsHint>
              </div>
            </>
          }
          syncRekordbox={synced.syncRekordbox}
          onSyncRekordboxChange={(on) => patch('syncRekordbox', on)}
          rekordboxAvailable={!!rekordboxCollection}
          rekordboxDetail={
            <>
              <SettingsLabel>{tr('settings.rekordboxDbPath')}</SettingsLabel>
              <div className="mt-2">
                <PathField
                  value={rekordboxCollection}
                  onChange={onChangeRekordboxDbPath}
                  testid="settings-rekordbox-db"
                  emptyLabel={tr('settings.traktorNmlPathEmpty')}
                />
              </div>
              <SettingsHint className="mt-2">{tr('settings.rekordboxDbPathHint')}</SettingsHint>
            </>
          }
          engineDetail={
            <EngineLibraryFields
              libraryDir={local.engineLibraryDir}
              onLibraryDirChange={onChangeEngineDir}
              playlist={synced.engineDjPlaylist}
              onPlaylistChange={(name) => patch('engineDjPlaylist', name)}
              testidPrefix="settings-engine"
            />
          }
          testidPrefix="settings"
        />
      </SettingsField>
      <SettingsSection>
        <SettingsField label={tr('settings.location')}>
          <LocationPicker
            locations={LOCATIONS}
            value={plan.location}
            onChange={(location) => applyPlan(withLocation(plan, location))}
            testidPrefix="settings-location"
            radioName="location"
            folderDetail={
              <OutputFolderField
                value={local.outputDir}
                onChange={onOutputDirChange}
                testid="settings-output"
              />
            }
          />
        </SettingsField>
      </SettingsSection>
      {/* Not a detail of the overwrite radio, which is where this started: Originals also
          fills from a format change and from a delete on a volume with no OS Trash, and
          hanging the setting off one destination left the other two paths ignoring it
          while the control was not even on screen. Its own section, always reachable. */}
      <SettingsSection eyebrow={tr('settings.originals')}>
        <SettingsHint className="-mt-1 mb-3">{tr('settings.originalsHint')}</SettingsHint>
        <SettingsLabel className="mb-2">{tr('settings.originalBackup')}</SettingsLabel>
        <SegmentedControl
          options={BACKUP_POLICIES}
          value={synced.backupPolicy}
          onChange={(id) => patch('backupPolicy', id)}
          testidPrefix="settings-backup"
          labelFor={(id) => tr(`settings.originalBackupPolicies.${id}`)}
        />
        {/* What this level costs, rather than one sentence covering all three: the choice
            IS the trade-off, so the line has to move with it. */}
        <SettingsHint className="mt-2.5" data-testid="settings-backup-hint">
          {tr(POLICY_HINT[synced.backupPolicy])}
        </SettingsHint>
        {/* Only 'never' can cost a file, and the word alone doesn't say so — least of all
            for the NAS delete, the one case where nothing else would have kept a copy.
            Amber, not danger red: switching it off is a legitimate choice, not a mistake. */}
        {synced.backupPolicy === 'never' && (
          <div
            data-testid="settings-backup-warning"
            className="mt-2.5 flex items-start gap-2 rounded-lg border border-[color-mix(in_srgb,var(--color-warn)_22%,transparent)] bg-[color-mix(in_srgb,var(--color-warn)_10%,transparent)] px-2.5 py-2"
          >
            <AlertTriangle
              className="mt-px h-3.5 w-3.5 shrink-0 text-warn"
              strokeWidth={1.8}
              aria-hidden="true"
            />
            <p className="text-xs leading-relaxed text-warn">
              {tr('settings.originalBackupNeverHint')}
            </p>
          </div>
        )}

        {/* Disabled rather than hidden under 'never' (Settings' own rule), and for a
            reason the hint states: they still govern the copies already stored. Turning
            the feature off must never read as having discarded them. */}
        <div className="mt-4 flex gap-4 border-t border-[var(--color-line)] pt-4">
          <div className="flex-1">
            <SettingsLabel htmlFor="backup-days" className="mb-2">
              {tr('settings.originalBackupDays')}
            </SettingsLabel>
            <div className="flex items-center gap-2">
              <input
                id="backup-days"
                data-testid="settings-backup-days"
                type="number"
                min={1}
                max={365}
                value={synced.backupRetentionDays}
                disabled={backupOff}
                onChange={(e) => patch('backupRetentionDays', Number(e.target.value))}
                className="w-20 rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-2.5 py-1.5 text-sm text-fg tabular-nums disabled:opacity-50"
              />
              <span className="text-xs text-fg-dim">{tr('settings.originalBackupDaysUnit')}</span>
            </div>
          </div>
          <div className="flex-1">
            <SettingsLabel htmlFor="backup-gb" className="mb-2">
              {tr('settings.originalBackupSize')}
            </SettingsLabel>
            <div className="flex items-center gap-2">
              <input
                id="backup-gb"
                data-testid="settings-backup-gb"
                type="number"
                min={0.1}
                max={1024}
                // "any", not a step: with min=0.1 a step of 0.5 makes the valid values
                // 0.1, 0.6, 1.1 … so the default of 10 failed the browser's own
                // constraint check and silently blocked the form from submitting —
                // Save did nothing at all, on a field the user had not even touched.
                step="any"
                value={synced.backupMaxGb}
                disabled={backupOff}
                onChange={(e) => patch('backupMaxGb', Number(e.target.value))}
                className="w-20 rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-2.5 py-1.5 text-sm text-fg tabular-nums disabled:opacity-50"
              />
              <span className="text-xs text-fg-dim">GB</span>
            </div>
          </div>
        </div>
        <SettingsHint className="mt-2.5">
          {backupOff
            ? tr('settings.originalBackupLimitsKept')
            : tr('settings.originalBackupLimitsHint')}
        </SettingsHint>
      </SettingsSection>
    </>
  )
}
