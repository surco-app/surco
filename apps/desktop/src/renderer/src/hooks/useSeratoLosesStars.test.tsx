// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CollectionTrack, Settings } from '../../../shared/types'
import { createQueryClient } from '../lib/queryClient'
import { SettingsProvider } from '../lib/settingsContext'
import { djReads, installApi } from '../test/api'
import { useSeratoLosesStars, useSeratoStarsLoss } from './useSeratoLosesStars'

const row = (path: string): CollectionTrack => ({
  contentId: path,
  path,
  title: 'Weekend',
  artist: 'Tantra',
})

function wrapperFor(
  settings: Partial<Settings>,
): ({ children }: { children: React.ReactNode }) => React.JSX.Element {
  const client = createQueryClient()
  return ({ children }) => (
    <QueryClientProvider client={client}>
      <SettingsProvider settings={settings}>{children}</SettingsProvider>
    </QueryClientProvider>
  )
}

const serato = (...paths: string[]): ReturnType<typeof djReads> =>
  djReads({ serato: { collection: async () => paths.map(row) } })

afterEach(() => vi.restoreAllMocks())

// Serato re-imports a repointed track as a new one, and the rating lives only in
// master.sqlite, which Surco cannot write (measured 04/11).
describe('useSeratoLosesStars', () => {
  it('warns when Serato holds the replaced file and follows replacements', async () => {
    installApi({ dj: serato('/s/old.wav') })
    const { result } = renderHook(() => useSeratoLosesStars('/s/old.wav'), {
      wrapper: wrapperFor({ syncSerato: true }),
    })
    await waitFor(() => expect(result.current).toBe(true))
  })

  it('warns with only Add to Serato on, since that also repoints the entry', async () => {
    installApi({ dj: serato('/s/old.wav') })
    const { result } = renderHook(() => useSeratoLosesStars('/s/old.wav'), {
      wrapper: wrapperFor({ addToSerato: true }),
    })
    await waitFor(() => expect(result.current).toBe(true))
  })

  it('stays quiet with both Sync and Add to Serato off, since Serato is left on the old file', async () => {
    const collection = vi.fn(async () => [row('/s/old.wav')])
    installApi({ dj: djReads({ serato: { collection } }) })
    const { result } = renderHook(() => useSeratoLosesStars('/s/old.wav'), {
      wrapper: wrapperFor({ syncSerato: false, addToSerato: false }),
    })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(result.current).toBe(false)
  })

  it('stays quiet when Serato does not hold the replaced file, as the queue repoints only files inside a library Serato holds', async () => {
    installApi({ dj: serato('/s/other.wav') })
    const { result } = renderHook(() => useSeratoLosesStars('/elsewhere/old.wav'), {
      wrapper: wrapperFor({ syncSerato: true }),
    })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(result.current).toBe(false)
  })

  // Several tracks replace several files: one Serato holds is one that loses its stars.
  it('warns when Serato holds any of the files several tracks replace', async () => {
    installApi({ dj: serato('/s/old.wav') })
    const { result } = renderHook(() => useSeratoLosesStars('/elsewhere/a.wav', '/s/old.wav'), {
      wrapper: wrapperFor({ syncSerato: true }),
    })
    await waitFor(() => expect(result.current).toBe(true))
  })

  it('stays quiet with no replaced file', async () => {
    installApi({ dj: serato('/s/old.wav') })
    const { result } = renderHook(() => useSeratoLosesStars(''), {
      wrapper: wrapperFor({ syncSerato: true }),
    })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(result.current).toBe(false)
  })
})

// Whether stars go cannot be told before Serato's collection is read, and a caller that must
// not replace blind needs that apart from a known no.
describe('useSeratoStarsLoss', () => {
  it('is unknown while Serato’s collection is still being read', () => {
    installApi({ dj: djReads({ serato: { collection: () => new Promise(() => {}) } }) })
    const { result } = renderHook(() => useSeratoStarsLoss('/s/old.wav'), {
      wrapper: wrapperFor({ syncSerato: true }),
    })
    expect(result.current).toBeUndefined()
  })

  it('is a known no with Sync and Add to Serato off, read or not', () => {
    installApi({ dj: djReads({ serato: { collection: () => new Promise(() => {}) } }) })
    const { result } = renderHook(() => useSeratoStarsLoss('/s/old.wav'), {
      wrapper: wrapperFor({ syncSerato: false, addToSerato: false }),
    })
    expect(result.current).toBe(false)
  })

  it('says yes once the collection shows Serato holds the file', async () => {
    installApi({ dj: serato('/s/old.wav') })
    const { result } = renderHook(() => useSeratoStarsLoss('/s/old.wav'), {
      wrapper: wrapperFor({ syncSerato: true }),
    })
    await waitFor(() => expect(result.current).toBe(true))
  })
})
