import { describe, expect, it } from 'vitest'
import { formatVersion } from './version'

describe('formatVersion', () => {
  // The download button already fetches /releases/latest; tag_name there is the
  // published version. GitHub tags aren't uniform across repos, so we normalise
  // to one "v"-prefixed label rather than print whatever the tag happened to be.
  it('keeps a v-prefixed tag as-is', () => {
    expect(formatVersion('v0.1.5')).toBe('v0.1.5')
  })

  it('adds the v prefix when the tag omits it', () => {
    expect(formatVersion('0.1.5')).toBe('v0.1.5')
  })

  it('trims surrounding whitespace', () => {
    expect(formatVersion('  v0.1.5  ')).toBe('v0.1.5')
  })

  // Null keeps the hero clean before the first release: same self-disabling
  // behaviour as the button and the download count, no manual flag to flip.
  it('is null before any release is published', () => {
    expect(formatVersion(null)).toBeNull()
    expect(formatVersion(undefined)).toBeNull()
    expect(formatVersion('')).toBeNull()
    expect(formatVersion('   ')).toBeNull()
  })
})
