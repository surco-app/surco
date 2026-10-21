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

function Letters(): React.JSX.Element {
  return <p data-testid="letters">{String(useAppSettings().cueLettersByTime)}</p>
}

describe('letter order as the renderer resolves it', () => {
  it('letters in track order before the stored settings arrive and for a value that is not a boolean', () => {
    render(
      <SettingsProvider settings={null}>
        <Letters />
      </SettingsProvider>,
    )
    expect(screen.getByTestId('letters').textContent).toBe('true')
    cleanup()
    render(
      <SettingsProvider settings={{ cueLettersByTime: 'no' as unknown as boolean }}>
        <Letters />
      </SettingsProvider>,
    )
    expect(screen.getByTestId('letters').textContent).toBe('true')
  })

  it('keeps the order off when the DJ turned it off', () => {
    render(
      <SettingsProvider settings={{ cueLettersByTime: false }}>
        <Letters />
      </SettingsProvider>,
    )
    expect(screen.getByTestId('letters').textContent).toBe('false')
  })
})
