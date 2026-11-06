// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../../i18n'
import type { LocalDraft } from '../../lib/settingsDraft'
;(window as unknown as { api: unknown }).api = {
  cacheStats: () => Promise.resolve({ files: 0, bytes: 0 }),
  clearCache: () => Promise.resolve(),
  revealBackups: () => Promise.resolve(),
  revealLog: () => Promise.resolve(),
}

import { AdvancedTab } from './AdvancedTab'

afterEach(cleanup)

function renderTab(analysisCacheGb: number) {
  const patchLocal = vi.fn()
  render(
    <AdvancedTab
      configDir={null}
      defaultDir={null}
      onChangeConfigDir={vi.fn()}
      onResetConfigDir={vi.fn()}
      onExportSettings={vi.fn()}
      onImportSettings={vi.fn()}
      settingsFileError=""
      local={{ analysisCacheGb } as LocalDraft}
      patchLocal={patchLocal}
    />,
  )
  return { patchLocal }
}

// A library of 8000 tracks re-measured itself on every launch behind a 2 GB cap nobody
// could see. The size is the user's to pick, said in the tracks it buys.
describe('AdvancedTab analysis cache size', () => {
  it('says how many analysed tracks the size holds', () => {
    renderTab(10)
    expect(screen.getByTestId('settings-cache-size-value')).toHaveTextContent(
      '10 GB · about 10,000 analysed tracks',
    )
  })

  it('stages the size picked on the slider', () => {
    const { patchLocal } = renderTab(10)
    fireEvent.change(screen.getByTestId('settings-cache-size'), { target: { value: '40' } })
    expect(patchLocal).toHaveBeenCalledWith('analysisCacheGb', 40)
  })
})
