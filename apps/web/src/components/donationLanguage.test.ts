// @vitest-environment jsdom
import { act, createElement } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DonateCancel from './DonateCancel'
import DonateCompleted from './DonateCompleted'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

describe('donation return page hydration', () => {
  for (const Component of [DonateCancel, DonateCompleted]) {
    for (const [language, home, heading] of [
      [
        'ja-JP',
        '/ja',
        Component === DonateCancel ? '寄付がキャンセルされました' : '本当にありがとうございます！',
      ],
      [
        'en-US',
        '/en',
        Component === DonateCancel ? 'Your donation was cancelled' : 'Thank you so much!',
      ],
      [
        'de-AT',
        '/de',
        Component === DonateCancel ? 'Deine Spende wurde abgebrochen' : 'Von Herzen danke!',
      ],
      [
        'fr-CA',
        '/fr',
        Component === DonateCancel ? 'Ton don n’a pas abouti' : 'Merci du fond du cœur !',
      ],
      [
        'pt-PT',
        '/pt',
        Component === DonateCancel ? 'A doação não foi concluída' : 'Muito obrigado, de coração!',
      ],
      [
        'es-ES',
        '/',
        Component === DonateCancel ? 'No se ha completado la donación' : '¡Gracias de corazón!',
      ],
    ]) {
      it(`${Component.name} keeps ${language} copy and home links after hydration`, async () => {
        vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
        vi.spyOn(navigator, 'language', 'get').mockReturnValue(language)
        vi.stubGlobal('matchMedia', () => ({ matches: true }))
        const container = document.createElement('div')
        document.body.append(container)
        // Trusted local component markup, not external HTML. Build output stays Spanish.
        container.innerHTML = renderToString(createElement(Component))
        expect(container.querySelector('h1')?.textContent).toBe(
          Component === DonateCancel ? 'No se ha completado la donación' : '¡Gracias de corazón!',
        )
        let root: ReturnType<typeof hydrateRoot>
        await act(async () => {
          root = hydrateRoot(container, createElement(Component))
        })
        try {
          expect(container.querySelector('h1')?.textContent).toBe(heading)
          expect(container.querySelector('main > a')?.getAttribute('href')).toBe(home)
          expect(container.querySelector('main > a:last-child')?.getAttribute('href')).toBe(home)
        } finally {
          await act(async () => root.unmount())
        }
      })
    }
  }
})
