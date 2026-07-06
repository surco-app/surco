// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { WhatsNewModal } from './WhatsNewModal'

// The modal derives its content from the live language, so the fixture must exist in
// both locales — the real files grow with every release and would make these tests
// about whatever shipped last.
vi.mock('../lib/changelog', () => ({
  changelogReleases: (locale: 'en' | 'es') =>
    locale === 'es'
      ? [
          {
            version: '0.33',
            date: '10 de julio de 2026',
            title: 'Novedades y avisos',
            items: [
              { text: 'Popup de novedades tras actualizar.', in: '0.33.0' },
              { text: 'Arreglo del análisis a 48 kHz.', in: '0.33.1' },
            ],
          },
          {
            version: '0.32',
            date: '3 de julio de 2026',
            title: 'Deshacer, sesiones que vuelven y ALAC',
            items: [{ text: 'Exportación M3U8 corregida.', in: '0.32.0' }],
          },
        ]
      : [
          {
            version: '0.33',
            date: 'July 10, 2026',
            title: 'News and notices',
            items: [
              { text: "What's-new popup after updating.", in: '0.33.0' },
              { text: '48 kHz analysis fixed.', in: '0.33.1' },
            ],
          },
          {
            version: '0.32',
            date: 'July 3, 2026',
            title: 'Undo, returning sessions and ALAC',
            items: [{ text: 'M3U8 export fixed.', in: '0.32.0' }],
          },
        ],
}))

beforeEach(() => {
  Object.assign(window, { api: { version: '0.33.1' } })
  void i18n.changeLanguage('es')
})
afterEach(cleanup)

describe('WhatsNewModal', () => {
  // The popup only exists to answer "what changed since my version": every batch it
  // selects must be on screen, under its release title, or the update news is lost.
  it('lists every unseen release batch with its title and items', () => {
    render(<WhatsNewModal lastSeen="0.31.0" onClose={vi.fn()} />)
    expect(screen.getByText('Novedades y avisos')).toBeInTheDocument()
    expect(screen.getByText('Deshacer, sesiones que vuelven y ALAC')).toBeInTheDocument()
    expect(screen.getByText('Popup de novedades tras actualizar.')).toBeInTheDocument()
    expect(screen.getByText('Exportación M3U8 corregida.')).toBeInTheDocument()
    expect(screen.getByText('v0.33')).toBeInTheDocument()
  })

  // One click and gone — the popup fires once per update (the caller stamps the
  // version), so it never needs a "don't show again" escape hatch.
  it('closes with the single acknowledgement button', () => {
    const onClose = vi.fn()
    render(<WhatsNewModal lastSeen="0.31.0" onClose={onClose} />)
    fireEvent.click(screen.getByTestId('whats-new-close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  // The content used to arrive pre-resolved in the language of the moment the popup
  // opened, so switching languages left a Spanish frame around English news. The modal
  // must pick its items from the live language like every other string on screen.
  it('re-renders the news in the freshly chosen language', async () => {
    await act(() => i18n.changeLanguage('en'))
    render(<WhatsNewModal lastSeen="0.31.0" onClose={vi.fn()} />)
    expect(screen.getByText('News and notices')).toBeInTheDocument()

    await act(() => i18n.changeLanguage('es'))

    expect(screen.getByText('Novedades y avisos')).toBeInTheDocument()
    expect(screen.queryByText('News and notices')).toBeNull()
  })
})
