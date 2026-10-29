// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlaylistSource } from '../../../../shared/types'
import i18n from '../../i18n'
import type { LocalDraft, SyncedDraft } from '../../lib/settingsDraft'

// The tab asks which sources this machine has on mount, so the bridge has to exist
// before it renders.
;(window as unknown as { api: unknown }).api = {
  revealBackups: vi.fn(),
  platform: 'darwin',
  rekordboxAvailable: () => Promise.resolve(true),
  engineAvailable: () => Promise.resolve(true),
  traktorAvailable: () => Promise.resolve(true),
}

import { GeneralTab } from './GeneralTab'

afterEach(cleanup)
afterEach(() => vi.unstubAllEnvs())

const synced = {
  theme: 'system',
  language: 'system',
  hiddenSources: [],
} as unknown as SyncedDraft
const local = { betaUpdates: false } as unknown as LocalDraft

function renderTab(
  over: Partial<LocalDraft> = {},
  hiddenSources: PlaylistSource[] = [],
  patch = vi.fn(),
) {
  const patchLocal = vi.fn()
  render(
    <GeneralTab
      synced={{ ...synced, hiddenSources }}
      patch={patch}
      local={{ ...local, ...over }}
      patchLocal={patchLocal}
      onPreviewTheme={vi.fn()}
    />,
  )
  return patchLocal
}

// The theme and language rows are segmented choices under a visible label; the label has
// to name the group too, or VoiceOver reads "Dark, toggle button" with no idea of what.
it('names the theme and language choices after their labels', () => {
  renderTab()
  expect(screen.getByRole('group', { name: i18n.t('settings.theme') })).toContainElement(
    screen.getByTestId('settings-theme-dark'),
  )
  expect(screen.getByRole('group', { name: i18n.t('settings.language') })).toContainElement(
    screen.getByTestId('settings-language-es'),
  )
  expect(screen.getByTestId('settings-language-ja')).toHaveTextContent('日本語')
})

it('persists a selected Japanese UI language through the settings patch', () => {
  const patch = vi.fn()
  renderTab({}, [], patch)

  fireEvent.click(screen.getByTestId('settings-language-ja'))

  expect(patch).toHaveBeenCalledWith('language', 'ja')
})

// Added after a run of regressions that reached users straight from a release: the
// tester who finds them needs the builds before everyone else does, and the rest of the
// users need to never see one by accident.
describe('GeneralTab beta channel', () => {
  // Both states, not just the default: asserting only the unchecked one passes just as
  // happily against a box hard-wired to false, which is a checkbox that can never show
  // what the machine is actually set to.
  it('shows the channel this machine is on', () => {
    renderTab()
    expect(screen.getByTestId('settings-beta-updates')).not.toBeChecked()
    cleanup()

    renderTab({ betaUpdates: true })
    expect(screen.getByTestId('settings-beta-updates')).toBeChecked()
  })

  // Reported from a screenshot: dropped in as a bare checkbox, it sat right under the
  // settings-folder hint and read as an option OF that folder. It is about updates, so
  // it needs its own titled section — the same shape every other block on this tab has.
  it('sits in its own section, not under the settings folder', () => {
    renderTab()

    const section = screen.getByTestId('settings-beta-updates').closest('section')
    expect(section).not.toBeNull()
    expect(section?.textContent).toContain(i18n.t('settings.updates'))
    expect(section?.textContent).not.toContain(i18n.t('settings.configDirHint'))
  })

  it('stages the channel switch', () => {
    const patchLocal = renderTab()

    fireEvent.click(screen.getByTestId('settings-beta-updates'))

    expect(patchLocal).toHaveBeenCalledWith('betaUpdates', true)
  })

  // A beta is not the same bargain as a stable build, and the checkbox alone does not
  // say so: the hint has to warn that these carry bugs and that the switch takes effect
  // on the next launch, or the user reads it as a plain "get updates sooner".
  it('says what taking betas means', () => {
    renderTab()

    const hint = screen.getByText(i18n.t('settings.betaUpdatesHint'))
    expect(hint.textContent).toMatch(/bugs|errores/i)
  })

  // A Store copy updates through the Store, which only ever ships stable builds. The box
  // stays where it is, greyed out and saying why, instead of vanishing from the tab; and
  // a user who comes from the installer with betas on still sees that it is on.
  it('stays visible but locked in a copy from the Microsoft Store', () => {
    const api = window.api as unknown as { storeBuild?: boolean }
    api.storeBuild = true
    try {
      renderTab({ betaUpdates: true })

      const box = screen.getByTestId('settings-beta-updates')
      expect(box).toBeDisabled()
      expect(box).toBeChecked()
      expect(screen.getByText(i18n.t('settings.betaUpdatesStoreHint'))).toBeInTheDocument()
    } finally {
      api.storeBuild = false
    }
  })

  it('stays open in the installer from the web', () => {
    renderTab()

    expect(screen.getByTestId('settings-beta-updates')).toBeEnabled()
  })
})

describe('GeneralTab sources', () => {
  function renderSources(
    {
      platform,
      rekordbox,
      engine = true,
      traktor = true,
    }: { platform: string; rekordbox: boolean; engine?: boolean; traktor?: boolean },
    hiddenSources: PlaylistSource[] = [],
  ) {
    Object.assign((window as unknown as { api: object }).api, {
      platform,
      rekordboxAvailable: () => Promise.resolve(rekordbox),
      engineAvailable: () => Promise.resolve(engine),
      traktorAvailable: () => Promise.resolve(traktor),
    })
    const patch = vi.fn<(key: 'hiddenSources', value: PlaylistSource[]) => void>()
    render(
      <GeneralTab
        synced={{ ...synced, hiddenSources }}
        patch={patch as never}
        local={local}
        patchLocal={vi.fn()}
        onPreviewTheme={vi.fn()}
      />,
    )
    return patch
  }

  it('shows one switch per source, on unless the source is hidden', async () => {
    renderSources({ platform: 'darwin', rekordbox: true }, ['rekordbox'])
    await waitFor(() => expect(screen.getByTestId('settings-source-rekordbox')).toBeEnabled())
    expect(screen.getByTestId('settings-source-appleMusic')).toBeChecked()
    expect(screen.getByTestId('settings-source-rekordbox')).not.toBeChecked()
  })

  it('hides a source when its switch is turned off and shows it again when turned on', async () => {
    const patch = renderSources({ platform: 'darwin', rekordbox: true }, ['rekordbox'])
    await waitFor(() => expect(screen.getByTestId('settings-source-rekordbox')).toBeEnabled())
    fireEvent.click(screen.getByTestId('settings-source-appleMusic'))
    fireEvent.click(screen.getByTestId('settings-source-rekordbox'))
    expect(patch.mock.calls).toEqual([
      ['hiddenSources', ['rekordbox', 'appleMusic']],
      ['hiddenSources', []],
    ])
  })

  it('keeps the Apple Music switch in view on Windows, disabled and saying why', async () => {
    renderSources({ platform: 'win32', rekordbox: true })
    await waitFor(() => expect(screen.getByTestId('settings-source-rekordbox')).toBeEnabled())
    expect(screen.getByTestId('settings-source-appleMusic')).toBeDisabled()
    expect(screen.getByText(i18n.t('settings.sourceAppleMusicUnavailable'))).toBeInTheDocument()
  })

  it('keeps the rekordbox switch in view without a collection, disabled and saying why', async () => {
    renderSources({ platform: 'darwin', rekordbox: false })
    await waitFor(() =>
      expect(screen.getByText(i18n.t('settings.sourceRekordboxUnavailable'))).toBeInTheDocument(),
    )
    expect(screen.getByTestId('settings-source-rekordbox')).toBeDisabled()
    expect(screen.getByTestId('settings-source-appleMusic')).toBeEnabled()
  })

  it('lets Engine DJ be hidden on a machine that has its library', async () => {
    const patch = renderSources({ platform: 'win32', rekordbox: false })
    const engine = screen.getByTestId('settings-source-engine')
    await waitFor(() => expect(engine).toBeEnabled())
    expect(engine).toBeChecked()
    fireEvent.click(engine)
    expect(patch).toHaveBeenCalledWith('hiddenSources', ['engine'])
  })

  it('keeps the Engine DJ switch in view without a library, disabled and saying why, as the rail leaves the source out there', async () => {
    renderSources({ platform: 'darwin', rekordbox: true, engine: false })
    await waitFor(() =>
      expect(screen.getByText(i18n.t('settings.sourceEngineUnavailable'))).toBeInTheDocument(),
    )
    expect(screen.getByTestId('settings-source-engine')).toBeDisabled()
    expect(screen.getByTestId('settings-source-rekordbox')).toBeEnabled()
  })

  it('lists Engine DJ in a release build too, now that its source is tested against Engine DJ and offered to every user', async () => {
    vi.stubEnv('DEV', false)
    renderSources({ platform: 'darwin', rekordbox: true })
    await waitFor(() => expect(screen.getByTestId('settings-source-rekordbox')).toBeEnabled())
    expect(screen.getByTestId('settings-source-engine')).toBeChecked()
  })

  it('lets Traktor be hidden on a machine where Traktor is installed', async () => {
    const patch = renderSources({ platform: 'darwin', rekordbox: true })
    const traktor = screen.getByTestId('settings-source-traktor')
    await waitFor(() => expect(traktor).toBeEnabled())
    expect(traktor).toBeChecked()
    fireEvent.click(traktor)
    expect(patch).toHaveBeenCalledWith('hiddenSources', ['traktor'])
  })

  it('keeps the Traktor switch in view without Traktor, disabled and saying why, as the rail leaves the source out there', async () => {
    renderSources({ platform: 'darwin', rekordbox: true, traktor: false })
    await waitFor(() =>
      expect(screen.getByText(i18n.t('settings.sourceTraktorUnavailable'))).toBeInTheDocument(),
    )
    expect(screen.getByTestId('settings-source-traktor')).toBeDisabled()
  })

  it('says that hiding a source leaves its sync alone', async () => {
    renderSources({ platform: 'darwin', rekordbox: true })
    expect(screen.getByTestId('settings-sources-hint')).toHaveTextContent(
      i18n.t('settings.sourcesHint'),
    )
  })
})

// The copies Surco takes before writing to rekordbox, Engine DJ or Traktor no longer sit
// next to each collection: a DJ restoring one has to be able to reach Surco's folder.
it('opens the folder with the collection backups', () => {
  renderTab()
  fireEvent.click(screen.getByTestId('settings-backups-reveal'))
  expect(
    (window as unknown as { api: { revealBackups: ReturnType<typeof vi.fn> } }).api.revealBackups,
  ).toHaveBeenCalled()
})
