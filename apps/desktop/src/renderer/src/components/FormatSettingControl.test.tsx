// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import '../i18n'
import { FormatSettingControl } from './FormatSettingControl'

afterEach(cleanup)

// Both places that show this picker (Settings and the onboarding wizard) title it
// "Default format", but only visually: the buttons themselves just say "AIFF", "FLAC"...
// so a screen reader has to hear what the group of formats is for.
describe('FormatSettingControl', () => {
  it('names the format picker as the default format', () => {
    render(<FormatSettingControl value="aiff" onChange={() => {}} testidPrefix="format" />)
    expect(screen.getByRole('group', { name: 'Default format' })).toBeInTheDocument()
  })
})
