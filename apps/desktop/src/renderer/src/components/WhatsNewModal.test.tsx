// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import { WhatsNewModal } from './WhatsNewModal'

afterEach(cleanup)

const releases = [
  {
    version: '0.33',
    title: 'Novedades y avisos',
    items: ['Popup de novedades tras actualizar.', 'Arreglo del análisis a 48 kHz.'],
  },
  {
    version: '0.32',
    title: 'Deshacer, sesiones que vuelven y ALAC',
    items: ['Exportación M3U8 corregida.'],
  },
]

describe('WhatsNewModal', () => {
  // The popup only exists to answer "what changed since my version": every batch it
  // was handed must be on screen, under its release title, or the update news is lost.
  it('lists every release batch with its title and items', () => {
    render(<WhatsNewModal releases={releases} onClose={vi.fn()} />)
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
    render(<WhatsNewModal releases={releases} onClose={onClose} />)
    fireEvent.click(screen.getByTestId('whats-new-close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
