// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// HelpModal's tree reads window.api.platform at render, so stub it before import.
vi.hoisted(() => {
  ;(globalThis.window as unknown as { api: unknown }).api = { platform: 'darwin' }
})

import '../i18n'
import { HelpModal } from './HelpModal'

afterEach(cleanup)

function withPlatform(platform: string, run: () => void): void {
  ;(window.api as unknown as { platform: string }).platform = platform
  try {
    run()
  } finally {
    ;(window.api as unknown as { platform: string }).platform = 'darwin'
  }
}

describe('HelpModal platform entries', () => {
  // The Apple Music FAQ describes a macOS-only integration; on Windows it would
  // document a feature the app doesn't offer, so the entry hides entirely.
  it('shows the Apple Music entry on macOS and no Windows entry', () => {
    render(<HelpModal onClose={() => {}} />)
    expect(screen.getByTestId('help-q-appleMusic')).toBeInTheDocument()
    expect(screen.queryByTestId('help-q-windows')).toBeNull()
  })

  it('swaps the Apple Music entry for the Windows limitations entry on Windows', () => {
    withPlatform('win32', () => {
      render(<HelpModal onClose={() => {}} />)
      expect(screen.queryByTestId('help-q-appleMusic')).toBeNull()
      expect(screen.getByTestId('help-q-windows')).toBeInTheDocument()
    })
  })

  it('keeps the shared entries on every platform', () => {
    withPlatform('win32', () => {
      render(<HelpModal onClose={() => {}} />)
      for (const id of ['token', 'quality', 'format']) {
        expect(screen.getByTestId(`help-q-${id}`)).toBeInTheDocument()
      }
    })
  })
})
