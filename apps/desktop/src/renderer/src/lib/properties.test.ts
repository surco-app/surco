import { describe, expect, it } from 'vitest'
import { formatFileSize } from './properties'

describe('formatFileSize', () => {
  it('keeps raw bytes below a kilobyte', () => {
    expect(formatFileSize(0)).toBe('0 B')
    expect(formatFileSize(512)).toBe('512 B')
  })

  it('rounds to whole kilobytes up to a megabyte', () => {
    expect(formatFileSize(1024)).toBe('1 KB')
    // The 321 KB tag Meta shows for a stripped WAV header
    expect(formatFileSize(328_704)).toBe('321 KB')
  })

  it('shows one decimal for megabytes', () => {
    expect(formatFileSize(58_400_000)).toBe('55.7 MB')
  })

  it('shows two decimals for gigabytes', () => {
    expect(formatFileSize(2_000_000_000)).toBe('1.86 GB')
  })

  it('returns an empty string for an unreadable size', () => {
    // A failed stat leaves the row blank rather than printing "NaN B".
    expect(formatFileSize(Number.NaN)).toBe('')
    expect(formatFileSize(-1)).toBe('')
  })
})
