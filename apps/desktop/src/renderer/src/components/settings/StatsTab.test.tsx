// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Settings } from '../../../../shared/types'
import '../../i18n'
import { StatsTab } from './StatsTab'

afterEach(cleanup)

describe('StatsTab', () => {
  // The lifetime counter is the tab's centerpiece: it turns "I used the app" into a
  // number the user can feel good about, right next to the donate ask.
  it('shows the lifetime conversion counter and time saved', () => {
    render(<StatsTab settings={{ conversionCount: 3 } as Settings} />)
    expect(screen.getByTestId('stats-count')).toHaveTextContent('3')
    expect(screen.getByTestId('stats-time-saved')).toBeInTheDocument()
    expect(screen.getByTestId('stats-donate')).toBeInTheDocument()
  })

  // Before the first conversion there is no tally to celebrate, only an invitation.
  it('shows the empty state until the first conversion', () => {
    render(<StatsTab settings={{ conversionCount: 0 } as Settings} />)
    expect(screen.getByTestId('stats-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('stats-count')).toBeNull()
  })
})
