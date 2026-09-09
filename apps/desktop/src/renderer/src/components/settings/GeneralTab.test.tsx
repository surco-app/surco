// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import type { LocalDraft, SyncedDraft } from '../../lib/settingsDraft'

// The tab reads its own cache size on mount, so the bridge has to exist before it
// renders — nothing here is about the cache, it just has to not throw.
;(window as unknown as { api: unknown }).api = {
  cacheStats: () => Promise.resolve({ entries: 0, bytes: 0 }),
  clearCache: () => Promise.resolve(),
  revealLog: () => {},
}

import { GeneralTab } from './GeneralTab'

afterEach(cleanup)

const synced = { theme: 'system', language: 'system' } as unknown as SyncedDraft
const local = { betaUpdates: false } as unknown as LocalDraft

function renderTab(over: Partial<LocalDraft> = {}) {
  const patchLocal = vi.fn()
  render(
    <GeneralTab
      synced={synced}
      patch={vi.fn()}
      local={{ ...local, ...over }}
      patchLocal={patchLocal}
      onPreviewTheme={vi.fn()}
      configDir={null}
      defaultDir="/Users/dj/Library/Application Support/Surco"
      onChangeConfigDir={vi.fn()}
      onResetConfigDir={vi.fn()}
      onExportSettings={vi.fn()}
      onImportSettings={vi.fn()}
    />,
  )
  return patchLocal
}

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
})
