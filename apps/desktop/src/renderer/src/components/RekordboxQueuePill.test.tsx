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

  it('explains a queue on hold and that only Apply now or Discard moves it', () => {
    setup({ ...STATE, halted: true })
    fireEvent.click(screen.getByTestId('rekordbox-queue-pill'))
    expect(screen.getByTestId('rekordbox-queue-halted')).toHaveTextContent(
      'The last change could not be saved or undone. Surco will not touch the collection until you choose Apply now or Discard. Apply now replaces the backup copy master.db.surco-backup, so if anything looks wrong, restore from it first',
    )
  })

  it('offers only Discard on a held queue with nothing left in it, since Discard is what lifts the hold', () => {
    setup({ tracks: 0, changes: 0, items: [], halted: true })
    fireEvent.click(screen.getByTestId('rekordbox-queue-pill'))
    expect(screen.queryByTestId('rekordbox-queue-apply')).toBeNull()
    expect(screen.getByTestId('rekordbox-queue-discard')).toBeInTheDocument()
  })

  it('explains a queue prepared for another collection', () => {
    setup({ ...STATE, elsewhere: true })
    fireEvent.click(screen.getByTestId('rekordbox-queue-pill'))
    expect(screen.getByTestId('rekordbox-queue-elsewhere')).toHaveTextContent(
      'This was prepared for another rekordbox collection. Surco will not apply it to the one you use now',
    )
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

  it('does not come back already open after the queue empties and fills again', () => {
    const view = render(
      <RekordboxQueuePill state={STATE} onApplyNow={vi.fn()} onDiscard={vi.fn()} />,
    )
    fireEvent.click(screen.getByTestId('rekordbox-queue-pill'))
    fireEvent.click(screen.getByTestId('rekordbox-queue-discard'))
    const empty = { tracks: 0, changes: 0, items: [] }
    view.rerender(<RekordboxQueuePill state={empty} onApplyNow={vi.fn()} onDiscard={vi.fn()} />)
    view.rerender(<RekordboxQueuePill state={STATE} onApplyNow={vi.fn()} onDiscard={vi.fn()} />)
    expect(screen.queryByTestId('rekordbox-queue-menu')).toBeNull()
  })

  it('keeps Escape to itself so the app behind does not also react', () => {
    setup()
    const behind = vi.fn()
    window.addEventListener('keydown', behind)
    fireEvent.click(screen.getByTestId('rekordbox-queue-pill'))
    fireEvent.keyDown(document.body, { key: 'Escape' })
    window.removeEventListener('keydown', behind)
    expect(behind).not.toHaveBeenCalled()
  })
})
