import { useSyncExternalStore } from 'react'

let openModals = 0
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

export function enterModal(): () => void {
  openModals += 1
  notify()
  return () => {
    openModals -= 1
    notify()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useModalOpen(): boolean {
  return useSyncExternalStore(subscribe, () => openModals > 0)
}
