// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '../lib/queryClient'
import { useDiskCacheSeed } from './useDiskCacheSeed'

afterEach(() => vi.restoreAllMocks())

describe('useDiskCacheSeed', () => {
  it('does not read the disk again for a track whose analysis this session already holds', async () => {
    const peekAnalysis = vi.fn().mockResolvedValue(null)
    ;(window as unknown as { api: unknown }).api = { peekAnalysis }
    const client = createQueryClient()
    client.setQueryData(['loudness', '/music/a.wav'], { integratedLufs: -9 })

    renderHook(() => useDiskCacheSeed('loudness', '/music/a.wav', true), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    })
    await new Promise((r) => setTimeout(r, 0))

    expect(peekAnalysis).not.toHaveBeenCalled()
  })
})
