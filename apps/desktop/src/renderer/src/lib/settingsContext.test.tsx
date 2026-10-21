// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { SettingsProvider, useAppSettings } from './settingsContext'

function Flows(): React.JSX.Element {
  const settings = useAppSettings()
  return (
    <p data-testid="flows">
      {`${settings.cueFlows.map((f) => f.id).join(',')}|${settings.activeCueFlow}`}
    </p>
  )
}

afterEach(cleanup)

describe('cue flows as the renderer resolves them', () => {
  it('starts a new DJ on the one bundled flow before the stored settings arrive', () => {
    render(
      <SettingsProvider settings={null}>
        <Flows />
      </SettingsProvider>,
    )
    expect(screen.getByTestId('flows').textContent).toBe('mix-in|mix-in')
  })

  it('brings back Mi flujo for settings that have it active without the flows, so the editor places the same cues', () => {
    render(
      <SettingsProvider settings={{ activeCueFlow: 'mine' }}>
        <Flows />
      </SettingsProvider>,
    )
    expect(screen.getByTestId('flows').textContent).toBe('mix-in,mine|mine')
  })
})
