// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import { ViewMenu } from './ViewMenu'

afterEach(cleanup)

describe('ViewMenu', () => {
  it('keeps itself inside the window when opened at the bottom right corner', () => {
    const size = { width: window.innerWidth, height: window.innerHeight }
    Object.assign(window, { innerWidth: 800, innerHeight: 600 })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.dataset.testid !== 'view-menu') return new DOMRect(0, 0, 0, 0)
      return new DOMRect(0, 0, 180, 120)
    })
    try {
      render(
        <ViewMenu
          x={780}
          y={590}
          label="View"
          items={[{ id: 'sidebar', label: 'Sidebar', checked: true, onToggle: () => {} }]}
          onClose={() => {}}
        />,
      )
      const menu = screen.getByTestId('view-menu')
      expect(menu.style.left).toBe('612px')
      expect(menu.style.top).toBe('472px')
    } finally {
      vi.restoreAllMocks()
      Object.assign(window, { innerWidth: size.width, innerHeight: size.height })
    }
  })

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
