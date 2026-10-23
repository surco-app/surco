// Who updates this copy of Surco. A Microsoft Store package lives in a read-only folder
// and receives every update from the Store, so electron-updater must stay out of it.
export type UpdateMode = 'dev' | 'store' | 'updater'

export function updateMode(env: { packaged: boolean; windowsStore: boolean }): UpdateMode {
  if (!env.packaged) return 'dev'
  return env.windowsStore ? 'store' : 'updater'
}
