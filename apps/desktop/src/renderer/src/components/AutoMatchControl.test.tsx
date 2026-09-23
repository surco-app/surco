// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { AutoMatchControl } from './AutoMatchControl'

afterEach(cleanup)

describe('AutoMatchControl', () => {
  it('labels the checkbox with the title alone so it lines up like every other setting', () => {
    render(
      <AutoMatchControl
        checked
        onChange={vi.fn()}
        searchProviders={['bandcamp']}
        discogsToken=""
        testid="settings-auto-match"
      />,
    )
    const label = screen.getByTestId('settings-auto-match').closest('label')
    expect(label).toHaveTextContent(new RegExp(`^${i18n.t('settings.autoMatch')}$`))
    expect(screen.getByText(i18n.t('settings.autoMatchHint'))).toBeInTheDocument()
  })
})
