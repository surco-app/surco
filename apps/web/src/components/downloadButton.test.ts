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
  sessionStorage.clear()
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

  it('fills the slot with the download arrow Cuts puts on its button once the link has resolved, at the spinner size so the text does not move', async () => {
    const container = await render('Mozilla/5.0 (iPhone)')
    const link = container.querySelector('a[href^="https://github.com"]')
    const lead = link?.querySelector('[data-testid="download-cta-lead"]')
    expect(lead?.tagName.toLowerCase()).toBe('svg')
    expect(lead?.getAttribute('aria-hidden')).toBe('true')
    expect(lead?.getAttribute('class')).toContain('size-4')
  })

  it('keeps the same slot when the release resolves to a platform installer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => [
          {
            tag_name: 'v1.2.3',
            draft: false,
            assets: [
              {
                name: 'Surco-1.2.3-setup.exe',
                size: 100_000_000,
                browser_download_url: 'https://example.test/Surco-1.2.3-setup.exe',
              },
            ],
          },
        ],
      })),
    )
    const container = await render('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
    const link = container.querySelector('a[href="https://example.test/Surco-1.2.3-setup.exe"]')
    expect(link?.querySelector('[data-testid="download-cta-lead"]')).not.toBeNull()
  })
})
