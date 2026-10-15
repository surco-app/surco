// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { EmptyActions } from './EmptyActions'

afterEach(cleanup)

describe('EmptyActions', () => {
  // A missing locale key renders as the raw key, so the first screen would show "empty.showDuplicates".
  it('labels the Apple Music duplicates button with its translated text, not its key', () => {
    render(
      <EmptyActions
        onAdd={vi.fn()}
        addShortcut="⌘O"
        onImportPlaylist={vi.fn()}
        onReviewMusic={vi.fn()}
        onShowDuplicates={vi.fn()}
      />,
    )
    const button = screen.getByTestId('empty-music-duplicates')
    expect(button).toHaveTextContent(i18n.t('empty.showDuplicates'))
    expect(button).not.toHaveTextContent('empty.showDuplicates')
  })
})
