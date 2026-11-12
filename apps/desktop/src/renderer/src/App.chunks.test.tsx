// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'

const { loaded, track } = vi.hoisted(() => {
  const loaded: string[] = []
  const track = (name: string) => async (importOriginal: () => Promise<object>) => {
    loaded.push(name)
    return importOriginal()
  }
  return { loaded, track }
})
vi.mock('./components/CopiesScreen', track('CopiesScreen'))
vi.mock('./components/UsbExportModal', track('UsbExportModal'))
vi.mock('./components/SessionWizard', track('SessionWizard'))
vi.mock('./components/PasteTracklistModal', track('PasteTracklistModal'))

// Everything App imports up front is parsed before the first paint. The copies screen, the
// USB export, the session wizard and the tracklist paste are opened now and then, never at
// launch, so they must stay out of that first load and arrive when first opened.
it('starts without loading the screens that are only opened now and then', async () => {
  Object.assign(window, { api: { platform: 'darwin', version: '0.0.0' } })
  await import('./App')
  expect(loaded).toEqual([])
})
