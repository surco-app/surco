import { describe, expect, it } from 'vitest'
import {
  CACHE_GB_MAX,
  CACHE_GB_MIN,
  cacheBytesOf,
  sanitizeCacheGb,
  smallCacheBytesFor,
  tracksThatFit,
} from './analysisCacheSize'

describe('analysis cache size', () => {
  // A fully analysed track keeps about 1 MB of wave, scan and spectrum image, so the
  // setting can say in tracks, the unit a DJ thinks in, what the gigabytes buy.
  it('says how many tracks fit, rounded to the hundred', () => {
    expect(tracksThatFit(10)).toBe(10_000)
    expect(tracksThatFit(40)).toBe(40_000)
    expect(tracksThatFit(2.5)).toBe(2_500)
  })

  it('repairs a value a synced or hand-edited file got wrong', () => {
    expect(sanitizeCacheGb(undefined)).toBe(10)
    expect(sanitizeCacheGb('x')).toBe(10)
    expect(sanitizeCacheGb(0)).toBe(CACHE_GB_MIN)
    expect(sanitizeCacheGb(10_000)).toBe(CACHE_GB_MAX)
    expect(sanitizeCacheGb(12.4)).toBe(12)
  })

  it('turns the setting into the prune budget', () => {
    expect(cacheBytesOf(10)).toBe(10 * 1024 ** 3)
  })

  // Tag reads, BPM, key and loudness are what a reopen serves for every row, about 40 KB a
  // track (measured 16/11). A fixed 1 GB held some 25,000 tracks, so a bigger library lost
  // its oldest reads on every launch and read them again off the NAS.
  it('gives the small results room for every track Surco knows, never less than 1 GB', () => {
    expect(smallCacheBytesFor(0)).toBe(1024 ** 3)
    expect(smallCacheBytesFor(10_000)).toBe(1024 ** 3)
    expect(smallCacheBytesFor(50_000)).toBe(50_000 * 64 * 1024)
  })
})
