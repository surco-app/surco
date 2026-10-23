import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

interface Redirect {
  source: string
  destination: string
  permanent: boolean
}

const vercel = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../vercel.json', import.meta.url)), 'utf8'),
) as { redirects?: Redirect[] }

// The code signing policy page existed for the SignPath application, which was turned down,
// and only its privacy half was still true. That half lives on as the privacy page; the old
// URL went out with the application and may be linked from elsewhere, so it lands there
// instead of a 404.
it('sends the retired code signing page to the privacy page in both languages', () => {
  expect(vercel.redirects).toEqual(
    expect.arrayContaining([
      { source: '/firma-de-codigo', destination: '/privacidad', permanent: true },
      { source: '/en/code-signing', destination: '/en/privacy', permanent: true },
    ]),
  )
})
