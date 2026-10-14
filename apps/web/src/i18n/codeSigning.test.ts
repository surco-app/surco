import { describe, expect, it } from 'vitest'
import en from './locales/en.json'
import es from './locales/es.json'

// SignPath Foundation signs the Windows installer for free on condition that the site
// carries a section titled "Code signing policy" with their attribution. If either goes
// missing they can revoke the certificate, and every installer already out there
// starts tripping SmartScreen again.
describe('code signing policy', () => {
  it('keeps the title SignPath asks for', () => {
    expect(en.codeSigning.title).toBe('Code signing policy')
  })

  it('carries the SignPath attribution in both languages', () => {
    expect(en.codeSigning.attribution).toBe(
      'Free code signing provided by SignPath.io, certificate by SignPath Foundation.',
    )
    expect(es.codeSigning.attribution).toContain('SignPath.io')
    expect(es.codeSigning.attribution).toContain('SignPath Foundation')
  })
})
