// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PropertiesSkeleton } from './PropertiesSkeleton'

afterEach(cleanup)

describe('PropertiesSkeleton', () => {
  // The placeholder must occupy the same two-group, two-column shape as the real readout so
  // ffprobe resolving swaps the table in without a layout jump — an open Properties section
  // on a cold track showed an empty body before this.
  it('renders the two grouped placeholder cards', () => {
    render(<PropertiesSkeleton />)
    const root = screen.getByTestId('properties-skeleton')
    expect(root).toBeInTheDocument()
    // Two grid groups (AUDIO + FILE), each a two-column grid.
    const grids = root.querySelectorAll('.grid-cols-2')
    expect(grids).toHaveLength(2)
  })
})
