// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type React from 'react'
import { describe, expect, it } from 'vitest'
import { DJ_PROGRAMS } from '../../../shared/djProgram'
import { djReads, installApi } from '../test/api'
import { useProgramsAvailable } from './useProgramsAvailable'

describe('useProgramsAvailable', () => {
  it.each(DJ_PROGRAMS)(
    'says %s is there only when its own program answers yes',
    async (program) => {
      installApi({ dj: djReads({ [program]: { available: async () => true } }) })
      const client = new QueryClient()
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      )
      const { result } = renderHook(() => useProgramsAvailable(), { wrapper })
      await waitFor(() => expect(result.current[program]).toBe(true))
      for (const other of DJ_PROGRAMS.filter((p) => p !== program))
        await waitFor(() => expect(result.current[other]).toBe(false))
      expect(client.getQueryState(['source-available', program])?.status).toBe('success')
    },
  )
})
