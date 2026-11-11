// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CustomField, TrackMetadata } from '../../../shared/types'
import i18n from './../i18n'
import { RenameModal } from './RenameModal'

afterEach(cleanup)

const META = { artist: 'Aladino', title: 'Make It Right Now' } as TrackMetadata

function renderModal(
  over: {
    initialFormat?: string
    meta?: Partial<TrackMetadata>
    customFields?: CustomField[]
  } = {},
): {
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
      customFields={over.customFields ?? []}
      onApply={onApply}
      onClose={onClose}
    />,
  )
  return { onApply, onClose }
}

describe('RenameModal', () => {
  // The user's own fields are tokens like Surco's: a chip under their name inserts the
  // key, and the preview fills it from the track.
  it('offers a custom field as a token and previews its value', () => {
    renderModal({
      initialFormat: '{artist}',
      meta: { custom: { vinylCondition: 'VG+' } },
      customFields: [{ key: 'vinylCondition', label: 'Estado del vinilo' }],
    })
    const chip = screen.getByTestId('rename-token-vinylCondition')
    expect(chip).toHaveTextContent('Estado del vinilo')
    fireEvent.click(chip)
    expect(screen.getByTestId('rename-preview')).toHaveTextContent('AladinoVG+')
  })

  // 35 chips in one heap weighed ISRC the same as Artist. The everyday fields come grouped
  // and in sight; the catalogue and credits wait behind one button, counted, so the dialog
  // opens on what a file name is actually built from.
  it('shows the everyday fields in named groups and keeps the catalogue ones behind a button', () => {
    renderModal()
    expect(screen.getByTestId('rename-group-identity')).toHaveTextContent('Basics')
    expect(screen.getByTestId('rename-group-dj')).toHaveTextContent('For DJing')
    expect(screen.getByTestId('rename-token-artist')).toBeInTheDocument()
    expect(screen.getByTestId('rename-token-bpm')).toBeInTheDocument()
    expect(screen.queryByTestId('rename-token-isrc')).toBeNull()
    const more = screen.getByTestId('rename-more-fields')
    expect(more).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(more)
    expect(more).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('rename-group-catalog')).toHaveTextContent('Release and credits')
    fireEvent.click(screen.getByTestId('rename-token-isrc'))
    expect(screen.getByTestId('rename-format')).toHaveValue('{artist} - {title}{isrc}')
  })

  it('exposes an accessible name on the dialog', () => {
    renderModal()
    expect(screen.getByRole('dialog')).toHaveAccessibleName()
  })

  it('lets the title and the token groups explain the dialog without a subtitle restating them', () => {
    renderModal()
    expect(screen.queryByText(/Combine text and metadata/)).toBeNull()
  })

  // The pattern field is the whole dialog; with only a placeholder a screen reader
  // announced a bare "edit text" and the placeholder vanished as soon as it was typed in.
  it('names the format field for assistive tech', () => {
    renderModal()
    expect(screen.getByTestId('rename-format')).toHaveAccessibleName(
      i18n.t('settings.filenameFormat'),
    )
  })

  // Enter in the pattern field submits the dialog's form instead of doing nothing.
  it('applies the rendered name when the form is submitted (Enter)', () => {
    const { onApply, onClose } = renderModal()
    fireEvent.submit(screen.getByTestId('rename-format').closest('form') as HTMLFormElement)
    expect(onApply).toHaveBeenCalledWith('Aladino - Make It Right Now')
    expect(onClose).toHaveBeenCalled()
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
