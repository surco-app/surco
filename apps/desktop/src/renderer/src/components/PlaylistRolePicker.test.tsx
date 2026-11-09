// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlaylistRole } from '../../../shared/sessionTypes'
import i18n from '../i18n'
import { PlaylistRolePicker } from './PlaylistRolePicker'

afterEach(cleanup)

function setup(value: PlaylistRole | null) {
  const onChange = vi.fn()
  render(<PlaylistRolePicker value={value} onChange={onChange} testIdPrefix="pick" />)
  return onChange
}

describe('PlaylistRolePicker', () => {
  it('offers the four roles with their names', () => {
    setup(null)
    expect(screen.getByTestId('pick-base')).toHaveTextContent(i18n.t('sessions.role.base'))
    expect(screen.getByTestId('pick-vocal')).toHaveTextContent(i18n.t('sessions.role.vocal'))
    expect(screen.getByTestId('pick-any')).toHaveTextContent(i18n.t('sessions.role.any'))
    expect(screen.getByTestId('pick-set')).toHaveTextContent(i18n.t('sessions.role.set'))
  })

  it('marks only the current role as pressed', () => {
    setup('vocal')
    expect(screen.getByTestId('pick-vocal')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('pick-base')).toHaveAttribute('aria-pressed', 'false')
  })

  it('marks nothing when the playlist has no role', () => {
    setup(null)
    for (const role of ['base', 'vocal', 'any', 'set']) {
      expect(screen.getByTestId(`pick-${role}`)).toHaveAttribute('aria-pressed', 'false')
    }
  })

  it('hands over the role that was pressed', () => {
    const onChange = setup('base')
    fireEvent.click(screen.getByTestId('pick-set'))
    expect(onChange).toHaveBeenCalledExactlyOnceWith('set')
  })

  it('takes the role away when the active one is pressed again', () => {
    const onChange = setup('set')
    fireEvent.click(screen.getByTestId('pick-set'))
    expect(onChange).toHaveBeenCalledExactlyOnceWith(null)
  })
})
