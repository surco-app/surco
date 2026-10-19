// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import type { RekordboxQueueState } from '../../../shared/types'
import { RekordboxQueuePill } from './RekordboxQueuePill'

afterEach(cleanup)

const STATE: RekordboxQueueState = {
  tracks: 1,
  changes: 1,
  items: [
    {
      key: 'track:/m/a.wav',
      label: 'Sister Nancy - Bam Bam',
      parts: [{ kind: 'collection' }, { kind: 'playlists', names: ['Makina', 'Cierre'] }],
    },
    { key: 'edit:e1', label: 'House', parts: [{ kind: 'tree', edit: 'rename' }] },
  ],
}

function setup(state = STATE) {
  const onApplyNow = vi.fn()
  const onDiscard = vi.fn()
  render(<RekordboxQueuePill state={state} onApplyNow={onApplyNow} onDiscard={onDiscard} />)
  return { onApplyNow, onDiscard }
}

describe('RekordboxQueuePill', () => {
  it('is not there when nothing waits', () => {
    setup({ tracks: 0, changes: 0, items: [] })
    expect(screen.queryByTestId('rekordbox-queue-pill')).toBeNull()
  })

  it('counts the waiting tracks', () => {
    setup()
    expect(screen.getByTestId('rekordbox-queue-pill')).toHaveTextContent(
      '1 track waits for you to close rekordbox',
    )
  })

  it('lists each track and what happens to it so the DJ checks what will land before closing rekordbox', () => {
    setup()
    fireEvent.click(screen.getByTestId('rekordbox-queue-pill'))
    expect(screen.getByTestId('rekordbox-queue-item-track:/m/a.wav')).toHaveTextContent(
      'Sister Nancy - Bam Bam',
    )
    expect(screen.getByTestId('rekordbox-queue-item-track:/m/a.wav')).toHaveTextContent(
      'added to the collection, to Makina, Cierre',
    )
    expect(screen.getByTestId('rekordbox-queue-item-edit:e1')).toHaveTextContent('House')
  })

  it('applies now from the menu', () => {
    const { onApplyNow } = setup()
    fireEvent.click(screen.getByTestId('rekordbox-queue-pill'))
    fireEvent.click(screen.getByTestId('rekordbox-queue-apply'))
    expect(onApplyNow).toHaveBeenCalled()
  })

  it('asks before discarding because the edits go back to what rekordbox says and that cannot be undone', () => {
    const { onDiscard } = setup()
    fireEvent.click(screen.getByTestId('rekordbox-queue-pill'))
    fireEvent.click(screen.getByTestId('rekordbox-queue-discard'))
    expect(onDiscard).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('rekordbox-queue-discard-no'))
    expect(onDiscard).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('rekordbox-queue-discard'))
    fireEvent.click(screen.getByTestId('rekordbox-queue-discard-yes'))
    expect(onDiscard).toHaveBeenCalled()
  })

  it('closes the menu on Escape', () => {
    setup()
    fireEvent.click(screen.getByTestId('rekordbox-queue-pill'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('rekordbox-queue-menu')).toBeNull()
  })

  it('closes the menu on a pointer press outside it but not inside', () => {
    setup()
    fireEvent.click(screen.getByTestId('rekordbox-queue-pill'))
    fireEvent.pointerDown(screen.getByTestId('rekordbox-queue-menu'))
    expect(screen.getByTestId('rekordbox-queue-menu')).toBeInTheDocument()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByTestId('rekordbox-queue-menu')).toBeNull()
  })
})
