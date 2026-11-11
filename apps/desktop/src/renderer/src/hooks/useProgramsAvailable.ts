import { useQueries } from '@tanstack/react-query'
import { DJ_PROGRAMS, type DjProgram } from '../../../shared/djProgram'
import { SOURCE_READ } from '../lib/sourcePrograms'

export function useProgramsAvailable(): Record<DjProgram, boolean | undefined> {
  return useQueries({
    queries: DJ_PROGRAMS.map((program) => ({
      queryKey: ['source-available', program],
      queryFn: SOURCE_READ[program].available,
      staleTime: Number.POSITIVE_INFINITY,
    })),
    combine: (results) =>
      Object.fromEntries(DJ_PROGRAMS.map((p, i) => [p, results[i].data])) as Record<
        DjProgram,
        boolean | undefined
      >,
  })
}
