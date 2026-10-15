// One dialog at a time for one question asked from many places: callers asking the same
// question (key) while it is up share its answer (one flush, one dialog), and a caller with
// a different question waits for it to close and then asks its own, so it never takes an
// answer given to wording it did not show. The rest of the arguments go to the asker.
export function sharedPrompt<K, R extends unknown[]>(
  ask: (key: K, ...rest: R) => Promise<boolean>,
): (key: K, ...rest: R) => Promise<boolean> {
  let pending: { key: K; answer: Promise<boolean> } | null = null
  return async (key, ...rest) => {
    while (pending && pending.key !== key) await pending.answer.catch(() => false)
    if (pending) return pending.answer
    const entry: { key: K; answer: Promise<boolean> } = {
      key,
      answer: ask(key, ...rest).finally(() => {
        if (pending === entry) pending = null
      }),
    }
    pending = entry
    return entry.answer
  }
}
