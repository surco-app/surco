import type React from 'react'
import { useTranslation } from 'react-i18next'
import { PathField } from './PathField'
import { SettingsHint, SettingsLabel } from './settings/SettingsPrimitives'

// The two fields Engine DJ needs before it can be a destination: where its library lives
// and which playlist the converted tracks join. Shared by Settings and the onboarding
// wizard, like OutputFolderField next to it — the wizard used to offer Engine DJ as a
// destination and ask neither, so a new user could finish setup with the destination set
// and the library pointing at a default folder that need not exist.
//
// It owns the folder dialog too, so neither surface reimplements the same round-trip.
export function EngineLibraryFields({
  libraryDir,
  onLibraryDirChange,
  playlist,
  onPlaylistChange,
  testidPrefix,
}: {
  libraryDir: string
  onLibraryDirChange: (dir: string) => void
  playlist: string
  onPlaylistChange: (name: string) => void
  testidPrefix: string
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  async function change(): Promise<void> {
    const dir = await window.api.pickEngineLibraryDir()
    if (dir) onLibraryDirChange(dir)
  }
  return (
    <div>
      <SettingsLabel htmlFor={`${testidPrefix}-library`} className="mb-2">
        {tr('settings.engineLibraryDir')}
      </SettingsLabel>
      <PathField
        value={libraryDir}
        onChange={() => void change()}
        testid={`${testidPrefix}-library`}
      />
      <SettingsHint className="mt-2">{tr('settings.engineLibraryDirHint')}</SettingsHint>
      <SettingsLabel htmlFor={`${testidPrefix}-playlist`} className="mt-4 mb-2">
        {tr('settings.engineDjPlaylist')}
      </SettingsLabel>
      <input
        id={`${testidPrefix}-playlist`}
        data-testid={`${testidPrefix}-playlist`}
        value={playlist}
        onChange={(e) => onPlaylistChange(e.target.value)}
        className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-3 py-2 text-sm"
      />
      <SettingsHint className="mt-2">{tr('settings.engineDjPlaylistHint')}</SettingsHint>
    </div>
  )
}
