import type React from 'react'
import { useTranslation } from 'react-i18next'
import { DESTINATIONS, fromDestination, toDestination } from '../../lib/destination'
import { isMacOS } from '../../lib/platform'
import type { LocalDraft, SyncedDraft } from '../../lib/settingsDraft'
import type { PatchSynced } from '../../lib/settingsTabs'
import { DestinationPicker } from '../DestinationPicker'
import { OutputFolderField } from '../OutputFolderField'
import { SettingsField, SettingsHint, SettingsLabel, SettingsSection } from './SettingsPrimitives'

// Apple Music automation only exists on macOS, so the destination is meaningless on
// other platforms where a track simply finishes in the output folder.
const isMac = isMacOS()

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
  onChangeEngineDir: () => void
  onChangeTraktorNmlPath: () => void
  // Empties the path, which is what turns the collection sync off (see settings.ts).
  onClearTraktorNmlPath: () => void
  // A candidate collection.nml autodetection found — null while unresolved or once
  // traktorNmlPath is already set (see SettingsModal). Never applied on its own; the
  // user accepts it explicitly via onAcceptDetectedNmlPath.
  detectedNmlPath: string | null
  onAcceptDetectedNmlPath: () => void
}

// Where a conversion ends up: the output folder, the destination radio (folder /
// Apple Music / Engine DJ / overwrite) and Engine DJ's own fields. Split from the
// Conversion tab, which keeps everything that defines the file itself — the format
// chosen there still gates the choices here (FLAC pins the folder).
export function DestinationTab({
  synced,
  local,
  patch,
  onOutputDirChange,
  onChangeEngineDir,
  onChangeTraktorNmlPath,
  onClearTraktorNmlPath,
  detectedNmlPath,
  onAcceptDetectedNmlPath,
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
  // FLAC can't go to Apple Music, so the destination is pinned to the output folder
  // while it's the format. Otherwise the stored booleans map onto the single radio choice.
  const flacOnly = synced.outputFormat === 'flac'
  const destination = toDestination(
    synced.addToAppleMusic,
    flacOnly,
    synced.overwriteOriginal,
    synced.addToEngineDj,
    synced.convertBesideOriginal,
  )
  function chooseDestination(d: (typeof DESTINATIONS)[number]): void {
    const next = fromDestination(d)
    patch('addToAppleMusic', next.addToAppleMusic)
    patch('keepOutputCopy', next.keepOutputCopy)
    patch('overwriteOriginal', next.overwriteOriginal)
    patch('addToEngineDj', next.addToEngineDj)
    patch('convertBesideOriginal', next.convertBesideOriginal)
  }
  // The folder is a detail OF the "Output folder" choice, so it renders under that
  // radio (via the picker's details slot) instead of floating above the group like an
  // unrelated global path — under Apple Music or overwrite there is no folder copy for
  // it to describe.
  const folderDetail = (
    <OutputFolderField
      value={local.outputDir}
      onChange={onOutputDirChange}
      testid="settings-output"
    />
  )
  // Engine DJ's fields nest under its radio exactly like the output folder does — the
  // two destination details read as one pattern instead of one inline and one trailing
  // the whole group.
  const engineDetail = (
    <div>
      <SettingsLabel htmlFor="settings-engine-library" className="mb-2">
        {tr('settings.engineLibraryDir')}
      </SettingsLabel>
      <div className="flex gap-2">
        <input
          id="settings-engine-library"
          data-testid="settings-engine-library"
          value={local.engineLibraryDir}
          readOnly
          className="min-w-0 flex-1 truncate rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-3 py-2 text-sm text-fg-muted"
        />
        <button
          type="button"
          onClick={onChangeEngineDir}
          className="press rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] px-3 py-2 text-sm hover:bg-[var(--color-line-strong)]"
        >
          {tr('common.change')}
        </button>
      </div>
      <SettingsHint className="mt-2">{tr('settings.engineLibraryDirHint')}</SettingsHint>
      <SettingsLabel htmlFor="settings-engine-playlist" className="mt-4 mb-2">
        {tr('settings.engineDjPlaylist')}
      </SettingsLabel>
      <input
        id="settings-engine-playlist"
        data-testid="settings-engine-playlist"
        value={synced.engineDjPlaylist}
        onChange={(e) => patch('engineDjPlaylist', e.target.value)}
        className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-3 py-2 text-sm"
      />
      <SettingsHint className="mt-2">{tr('settings.engineDjPlaylistHint')}</SettingsHint>
    </div>
  )
  return (
    <>
      <SettingsField label={tr('settings.destination')}>
        <DestinationPicker
          destinations={DESTINATIONS.filter((d) => isMac || d !== 'appleMusic')}
          value={destination}
          onChange={chooseDestination}
          flacOnly={flacOnly}
          testidPrefix="settings-destination"
          radioName="destination"
          details={{ folder: folderDetail, engineDj: engineDetail }}
        />
      </SettingsField>
      {/* Independent of the destination radio above: Traktor sync patches cue points
          into collection.nml as a side effect of conversion, wherever the file ends up —
          it isn't itself a place the converted file goes. Empty path means the feature
          is off (see settings.ts), so this is the only control that turns it on. */}
      <SettingsSection eyebrow={tr('settings.traktorSync')}>
        {/* No htmlFor: the value below is a read-only display, not a form control, so
            there is nothing for a label to focus. */}
        <SettingsLabel>{tr('settings.traktorNmlPath')}</SettingsLabel>
        <div className="mt-2 flex gap-2">
          {/* Not an input: nothing can be typed here, the path only ever changes through
              "Change". As an input it took a caret on click, and the browser then scrolled
              the text sideways to reveal the end — hiding the start of the path on top of
              the truncation already clipping the end (tabIndex={-1} did not help: it stops
              tabbing, not clicking). A plain element can't be focused or scrolled, and
              title still carries the full path for anyone who needs to read it whole. */}
          <div
            id="settings-traktor-nml"
            data-testid="settings-traktor-nml"
            title={local.traktorNmlPath}
            className="min-w-0 flex-1 truncate rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-3 py-2 text-sm text-fg-muted"
          >
            {local.traktorNmlPath}
          </div>
          <button
            type="button"
            data-testid="settings-traktor-nml-change"
            onClick={onChangeTraktorNmlPath}
            className="press rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] px-3 py-2 text-sm hover:bg-[var(--color-line-strong)]"
          >
            {tr('common.change')}
          </button>
          {/* The hint promises "leave it empty to turn this off" and Change only ever
              opens a file picker, so the sync could be started and never stopped: a DJ
              wanting Surco to stop touching his collection had to point it at some other
              path instead. Only shown with something to clear. */}
          {local.traktorNmlPath && (
            <button
              type="button"
              data-testid="settings-traktor-nml-clear"
              onClick={onClearTraktorNmlPath}
              className="press rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] px-3 py-2 text-sm hover:bg-[var(--color-line-strong)]"
            >
              {tr('common.clear')}
            </button>
          )}
        </div>
        <SettingsHint className="mt-2">{tr('settings.traktorNmlPathHint')}</SettingsHint>
        {/* Never applied without this explicit click — autodetection only proposes,
            it must never silently pick a version folder or write to it. */}
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
                  className="press flex cursor-pointer items-center gap-2.5 rounded-lg px-1 py-1.5 hover:bg-[var(--color-panel-2)]/30 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[var(--color-accent)]"
                >
                  <input
                    type="radio"
                    name="settings-cue-direction"
                    data-testid={`settings-cue-dir-${id}`}
                    checked={chosen}
                    onChange={() =>
                      patch(
                        'traktorCueOffsetMs',
                        id === 'none' ? '0' : String(CUE_SIGN[id] * (magnitude || CUE_DEFAULT_MS)),
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
            <span className="flex-1 text-sm text-fg-muted">{tr('settings.traktorCueAmount')}</span>
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
      </SettingsSection>
    </>
  )
}
