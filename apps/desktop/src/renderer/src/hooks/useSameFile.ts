import { useEffect, useState } from 'react'

// Whether the open file and a library copy are one file on disk, asked of main because the
// path text cannot tell: a file opened through a symlinked folder has another path than the
// one the library indexed. Undefined while main has not answered for this pair.
export function useSameFile(openPath: string, copyPath: string): boolean | undefined {
  const [answer, setAnswer] = useState<{ key: string; same: boolean } | null>(null)
  useEffect(() => {
    if (!copyPath) return
    let cancelled = false
    void window.api
      .sameFile(openPath, copyPath)
      .catch(() => false)
      .then((same) => {
        if (!cancelled) setAnswer({ key: `${openPath}\n${copyPath}`, same })
      })
    return () => {
      cancelled = true
    }
  }, [openPath, copyPath])
  if (!copyPath) return false
  return answer?.key === `${openPath}\n${copyPath}` ? answer.same : undefined
}
