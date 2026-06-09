// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TrackMetadata } from '../../../shared/types'
import './../i18n'
import { RenameModal } from './RenameModal'

afterEach(cleanup)

const META = { artist: 'Aladino', title: 'Make It Right Now' } as TrackMetadata

function renderModal(over: { initialFormat?: string; meta?: Partial<TrackMetadata> } = {}): {
  onApply: ReturnType<typeof vi.fn>
  onClose: ReturnType<typeof vi.fn>
} {
  const onApply = vi.fn()
  const onClose = vi.fn()
  render(
    <RenameModal
      meta={{ ...META, ...over.meta }}
      initialFormat={over.initialFormat ?? '{artist} - {title}'}
      extension="aiff"
      onApply={onApply}
      onClose={onClose}
    />,
  )
  return { onApply, onClose }
}

describe('RenameModal', () => {
  it('exposes an accessible name on the dialog', () => {
    renderModal()
    expect(screen.getByRole('dialog')).toHaveAccessibleName()
  })

  // The dialog opens seeded with the saved pattern so the common case is one click,
  // and the preview proves what the name becomes for THIS track before committing.
  it('seeds the saved pattern and previews it against the track', () => {
    renderModal()
    expect(screen.getByTestId('rename-format')).toHaveValue('{artist} - {title}')
    expect(screen.getByTestId('rename-preview')).toHaveTextContent(
      'Aladino - Make It Right Now.aiff',
    )
  })

  // Chips are the no-typing path to a valid token; inserting one must extend the
  // pattern (and thus the preview) rather than replace it.
  it('appends a field token when its chip is clicked', () => {
    renderModal({ initialFormat: '{artist}' })
    fireEvent.click(screen.getByTestId('rename-token-title'))
    expect(screen.getByTestId('rename-format')).toHaveValue('{artist}{title}')
  })

  // Apply is the whole point: it writes the rendered name back (without extension,
  // which the field appends) and dismisses the dialog.
  it('applies the rendered name and closes', () => {
    const { onApply, onClose } = renderModal()
    fireEvent.click(screen.getByTestId('rename-apply'))
    expect(onApply).toHaveBeenCalledWith('Aladino - Make It Right Now')
    expect(onClose).toHaveBeenCalled()
  })

  it('closes without applying when cancelled', () => {
    const { onApply, onClose } = renderModal()
    fireEvent.click(screen.getByTestId('rename-cancel'))
    expect(onApply).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  // An empty render would rename the file to just its extension, so Apply is blocked
  // until the pattern produces something.
  it('disables apply when the pattern renders empty', () => {
    renderModal({ initialFormat: '', meta: { artist: '', title: '' } })
    expect(screen.getByTestId('rename-apply')).toBeDisabled()
  })
})
