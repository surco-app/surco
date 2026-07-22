import type React from 'react'
import { lazy, Suspense } from 'react'
import type { FormatSetting, Settings, ThemePref, TrackMetadata } from '../../../shared/types'
import { ConfirmDialog } from './ConfirmDialog'
import type { Command } from '../lib/commands'
import { formatExtension } from '../../../shared/format'
import type { ActiveModal } from '../hooks/useOverlays'
import type { TrackItem } from '../types'


// On-demand overlays: none is part of the first paint (each renders only behind its
// activeModal branch), so each is split into its own chunk and kept out of the startup
// parse, loading the first time the user opens it. The .then unwraps the named export
// React.lazy needs as a default.
const SettingsModal = lazy(() =>
  import('./SettingsModal').then((m) => ({ default: m.SettingsModal })),
)
const OnboardingWizard = lazy(() =>
  import('./OnboardingWizard').then((m) => ({ default: m.OnboardingWizard })),
)
const DonateNudgeModal = lazy(() =>
  import('./DonateNudgeModal').then((m) => ({ default: m.DonateNudgeModal })),
)
const WhatsNewModal = lazy(() =>
  import('./WhatsNewModal').then((m) => ({ default: m.WhatsNewModal })),
)
const HelpModal = lazy(() =>
  import('./HelpModal').then((m) => ({ default: m.HelpModal })),
)
const LoudnessHelpModal = lazy(() =>
  import('./LoudnessHelpModal').then((m) => ({ default: m.LoudnessHelpModal })),
)
const FindReplaceModal = lazy(() =>
  import('./FindReplaceModal').then((m) => ({ default: m.FindReplaceModal })),
)
const StripNumberingModal = lazy(() =>
  import('./StripNumberingModal').then((m) => ({ default: m.StripNumberingModal })),
)
const RenameModal = lazy(() =>
  import('./RenameModal').then((m) => ({ default: m.RenameModal })),
)
const ExportModal = lazy(() =>
  import('./ExportModal').then((m) => ({ default: m.ExportModal })),
)
const CommandPalette = lazy(() =>
  import('./CommandPalette').then((m) => ({ default: m.CommandPalette })),
)

interface Props {
  activeModal: ActiveModal
  settings: Settings | null
  selected: TrackItem | null
  // The scope a bulk overlay acts on: the selection, or the visible list when nothing is
  // selected.
  bulkTracks: TrackItem[]
  visibleTracks: TrackItem[]
  // Called lazily, only when the palette actually opens — building the registry is not
  // free and every other overlay ignores it.
  getCommands: () => Command[]
  // The editor's one-shot format pick, which decides the extension the rename preview shows.
  editorFormatRef: React.RefObject<FormatSetting | null>
  close: () => void
  // Dismisses the palette only if it is STILL the active modal: a command's run() may have
  // opened another overlay, and closing blindly would clobber it.
  closeIfPalette: () => void
  // Settings closes through its own handler: it must also drop any live theme preview, or
  // a previewed-but-unsaved theme would stick after the modal is gone.
  closeSettings: () => void
  saveSettings: (patch: Partial<Settings>) => void
  setSettings: React.Dispatch<React.SetStateAction<Settings | null>>
  setThemePreview: (pref: ThemePref | null) => void
  finishOnboarding: (patch: Partial<Settings>) => void
  deriveTracksUndoable: (patches: { id: string; meta: Partial<TrackMetadata> }[]) => void
  updateTrack: (id: string, patch: Partial<TrackItem>) => void
  revealSelection: (id: string) => void
}

// Every overlay the app can raise, and the one place that decides which is up. Split out of
// App, where these ten branches were 90 lines of JSX wedged between the layout and the
// toasts; nothing here holds state — activeModal decides, App owns the handlers.
export function Overlays({
  activeModal,
  settings,
  selected,
  bulkTracks,
  visibleTracks,
  getCommands,
  editorFormatRef,
  close,
  closeIfPalette,
  closeSettings,
  saveSettings,
  setSettings,
  setThemePreview,
  finishOnboarding,
  deriveTracksUndoable,
  updateTrack,
  revealSelection,
}: Props): React.JSX.Element {
  // Each run bumps its command's counter, so the palette can float the user's habits up the
  // filtered list. It lived inline in the JSX prop below — a state write dressed as markup.
  const recordCommandRun = (id: string): void =>
    saveSettings({
      commandUsage: {
        ...(settings?.commandUsage ?? {}),
        [id]: (settings?.commandUsage?.[id] ?? 0) + 1,
      },
    })

  return (
    <Suspense fallback={null}>
      {activeModal?.type === 'settings' && settings && (
        <SettingsModal
          settings={settings}
          onClose={closeSettings}
          onSave={saveSettings}
          onPreviewTheme={setThemePreview}
          onSettingsReplaced={setSettings}
          initialTab={activeModal.tab}
        />
      )}

      {activeModal?.type === 'onboarding' && settings && (
        <OnboardingWizard settings={settings} onFinish={finishOnboarding} />
      )}

      {activeModal?.type === 'donateNudge' && (
        <DonateNudgeModal
          conversionCount={settings?.conversionCount ?? 0}
          onClose={(dismissForever) => {
            if (dismissForever) saveSettings({ donateNudgeDismissed: true })
            close()
          }}
        />
      )}

      {activeModal?.type === 'whatsNew' && (
        <WhatsNewModal lastSeen={activeModal.lastSeen} onClose={close} />
      )}

      {activeModal?.type === 'help' && <HelpModal onClose={close} />}
      {activeModal?.type === 'loudnessHelp' && <LoudnessHelpModal onClose={close} />}
      {activeModal?.type === 'findReplace' && (
        <FindReplaceModal
          tracks={bulkTracks}
          onApply={deriveTracksUndoable}
          onClose={close}
        />
      )}
      {activeModal?.type === 'stripNumbering' && (
        <StripNumberingModal
          tracks={bulkTracks}
          onApply={deriveTracksUndoable}
          onClose={close}
        />
      )}
      {activeModal?.type === 'rename' && selected && (
        <RenameModal
          meta={selected.meta}
          initialFormat={settings?.filenameFormat ?? '{artist} - {title}'}
          extension={formatExtension(
            (editorFormatRef.current !== 'source' ? editorFormatRef.current : undefined) ??
              (settings?.outputFormat !== 'source' ? settings?.outputFormat : undefined) ??
              'aiff',
          )}
          onApply={(outputName) => updateTrack(selected.id, { outputName })}
          onClose={close}
        />
      )}
      {activeModal?.type === 'export' && (
        <ExportModal tracks={bulkTracks} onClose={close} />
      )}
      {activeModal?.type === 'confirm' && (
        <ConfirmDialog
          title={activeModal.confirm.title}
          message={activeModal.confirm.message}
          confirmLabel={activeModal.confirm.confirmLabel}
          confirmDisabled={activeModal.confirm.confirmDisabled}
          destructive={activeModal.confirm.destructive}
          onConfirm={activeModal.confirm.onConfirm}
          onClose={close}
        />
      )}

      {activeModal?.type === 'palette' && (
        <CommandPalette
          commands={getCommands()}
          // Searching by title/artist turns ⌘K into a jump-to-track launcher over the
          // visible list; picking a track selects and scrolls to it, then the palette
          // closes itself (runAt → onClose) like any other command.
          tracks={visibleTracks}
          onGoToTrack={revealSelection}
          usage={settings?.commandUsage ?? {}}
          // Learn from each run so the next filtered list floats the user's habits up.
          onRunCommand={recordCommandRun}
          // A command's run() may itself open another modal (settings, find & replace,
          // export…). Closing the palette must not clobber that: only dismiss it when the
          // palette is still the active modal, so a command that navigated elsewhere wins.
          onClose={closeIfPalette}
        />
      )}
    </Suspense>
  )
}
