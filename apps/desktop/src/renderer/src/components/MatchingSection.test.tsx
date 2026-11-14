// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import type { MatchingPartner } from '../lib/matchingPartners'
import { MatchingSection } from './MatchingSection'

afterEach(cleanup)

const TAKE: MatchingPartner = {
  contentId: '2',
  path: '/m/take.wav',
  title: 'Take Me Home',
  artist: 'Wonder Blue',
  key: '2A',
}

function setup(partners: MatchingPartner[], open = true) {
  const handlers = { onPick: vi.fn(), onToggle: vi.fn() }
  render(<MatchingSection partners={partners} open={open} {...handlers} />)
  return handlers
}

describe('MatchingSection', () => {
  it('lists the tracks the DJ paired with this one in rekordbox', () => {
    setup([TAKE])
    expect(screen.getByTestId('matching-partner')).toHaveTextContent('Take Me Home')
    expect(screen.getByTestId('matching-partner')).toHaveTextContent('Wonder Blue')
    expect(screen.getByTestId('matching-partner')).toHaveTextContent('2A')
  })

  it('jumps to a partner when the DJ picks it, to hear or edit the other half of the pair', () => {
    const { onPick } = setup([TAKE])
    fireEvent.click(screen.getByTestId('matching-partner'))
    expect(onPick).toHaveBeenCalledWith(TAKE)
  })

  // Most tracks have no partner; the section stays out of the way until one does.
  it('renders nothing for a track without partners', () => {
    setup([])
    expect(screen.queryByTestId('matching-section')).not.toBeInTheDocument()
  })
})
