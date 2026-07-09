import type { DockIconFrames } from '../shared/types'

// dock:frames is renderer input into an ipcMain.on listener, where a throw is
// fatal to the whole app — validate the shape and degrade to a no-op (the shipped
// icon stays) instead of trusting the declared type across the IPC boundary.
export function parseDockFrames(payload: unknown): DockIconFrames | null {
  if (typeof payload !== 'object' || payload === null) return null
  const { resting, frames } = payload as { resting?: unknown; frames?: unknown }
  if (typeof resting !== 'string') return null
  if (!Array.isArray(frames) || !frames.every((f) => typeof f === 'string')) return null
  return { resting, frames }
}
