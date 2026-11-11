import { createRekordboxQueue, type QueueApply, type RekordboxQueue } from './rekordboxQueue'

export function queueWithApplyInFlight(createdId: string): {
  queue: RekordboxQueue
  inFlight: Promise<QueueApply>
  release: () => Promise<void>
} {
  let open: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    open = resolve
  })
  let stored: string | null = null
  const queue = createRekordboxQueue({
    store: {
      read: () => stored,
      write: (text) => {
        stored = text
      },
      setAside: () => {
        stored = null
      },
    },
    collection: () => '/library',
    applyBatch: async (_collection, ops) => ({
      ok: true,
      wrote: true,
      outcomes: ops.map((op) => ({ id: op.id, applied: true, notices: [], createdId })),
    }),
    repoint: async () => {
      await gate
      return [{ written: true }]
    },
    nodeStamps: async () => ({}),
    onChange: () => {},
  })
  queue.enqueue([], [{ from: '/music/a.mp3', to: '/music/a.aiff' }])
  const inFlight = queue.apply(async () => true)
  return {
    queue,
    inFlight,
    release: async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
      open()
      await inFlight
    },
  }
}
