// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadI18n } from '../i18n'
import DownloadButton from './DownloadButton'

let root: Root | null = null

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = null
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

async function render(userAgent: string): Promise<HTMLElement> {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent)
  const i18n = await loadI18n('es')
  const container = document.createElement('div')
  document.body.append(container)
  await act(async () => {
    root = createRoot(container)
    root.render(
      createElement(I18nextProvider, { i18n }, createElement(DownloadButton, { location: 'hero' })),
    )
  })
  return container
}

describe('DownloadButton leading slot', () => {
  it('keeps the spinner slot while the release is pending', async () => {
    const container = await render('')
    const pending = container.querySelector('[data-testid="download-cta-pending"]')
    expect(pending?.querySelector('[data-testid="download-cta-lead"]')).not.toBeNull()
  })

  it('keeps an empty slot of the same size once the link has resolved, so the text does not move', async () => {
    const container = await render('Mozilla/5.0 (iPhone)')
    const link = container.querySelector('a[href^="https://github.com"]')
    const lead = link?.querySelector('[data-testid="download-cta-lead"]')
    expect(lead).not.toBeNull()
    expect(lead?.getAttribute('aria-hidden')).toBe('true')
    expect(lead?.className).toContain('size-4')
  })
})
