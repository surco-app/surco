// A file-name conflict prompts once per collision, so a batch of similarly-named rips used
// to interrupt N times. This remembers an "apply to the rest" choice for the run: once the
// user ticks the box, every later conflict reuses that decision without asking. Reset at the
// top of each batch so a choice never leaks into the next run. Module-scoped in index.ts
// because a batch fans out into separate process:track IPC calls that must share it.
export type ConflictDecision = 'overwrite' | 'keepBoth' | 'skip'

export interface StickyConflict {
  // Returns the remembered decision if one is set; otherwise runs `ask`, and remembers its
  // decision when the user opted to apply it to the rest of the run.
  resolve: (
    ask: () => Promise<{ decision: ConflictDecision; remember: boolean }>,
  ) => Promise<ConflictDecision>
  // Forgets any remembered decision — called when a new run begins.
  reset: () => void
}

export function createStickyConflict(): StickyConflict {
  let remembered: ConflictDecision | null = null
  return {
    resolve: async (ask) => {
      if (remembered) return remembered
      const { decision, remember } = await ask()
      if (remember) remembered = decision
      return decision
    },
    reset: () => {
      remembered = null
    },
  }
}
