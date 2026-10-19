import { useSyncExternalStore } from 'react'
import {
  IDLE_EXPORT,
  type UsbExportAction,
  type UsbExportState,
  usbExportReducer,
} from './usbExport'

// The export's state outside React (spec: App must not re-render on every byte tick). Each
// consumer reads its own slice with useUsbExportState; a selector must return a primitive or
// an object that only changes when its slice does (a row is replaced only when that row
// changes), or useSyncExternalStore would re-render on every dispatch.
export interface UsbExportStore {
  getState: () => UsbExportState
  subscribe: (listener: () => void) => () => void
  dispatch: (a: UsbExportAction) => void
}

export function createUsbExportStore(now: () => number = Date.now): UsbExportStore {
  let state = IDLE_EXPORT
  const listeners = new Set<() => void>()
  return {
    getState: () => state,
    subscribe: (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    dispatch: (a) => {
      state = usbExportReducer(state, a, now())
      for (const l of listeners) l()
    },
  }
}

export const usbExportStore = createUsbExportStore()

export function useUsbExportState<T>(
  selector: (s: UsbExportState) => T,
  store: UsbExportStore = usbExportStore,
): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()))
}

// Called once by App: the main process's events go straight into the store.
export function connectUsbExportFeed(store: UsbExportStore = usbExportStore): () => void {
  return window.api.onUsbEvent((e) => store.dispatch(e))
}
