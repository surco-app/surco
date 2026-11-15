// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import '../i18n'
import { ViewMenu } from './ViewMenu'

afterEach(cleanup)

describe('ViewMenu', () => {
  it('opens on the next frame like every other right-click menu, since a context menu answers the click instead of performing', () => {
    render(
      <ViewMenu
        x={10}
        y={10}
        label="View"
        items={[{ id: 'sidebar', label: 'Sidebar', checked: true, onToggle: () => {} }]}
        onClose={() => {}}
      />,
    )
    expect(screen.getByTestId('view-menu').className).not.toContain('animate-')
  })
})
