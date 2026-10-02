import type { MediaAccess } from './mediaAccess'

// What a folder watcher does when it spots late-arriving tracks: grant them media access,
// THEN tell the renderer. The grant is the easy-to-forget half — the surco:// handler 403s
// any path the app never registered, so a watched track would be added to the list and shown
// in the player yet refuse to play. Normal imports (files:pick / files:expand) register their
// paths the same way; the watcher must too.
//
// A path a conversion has reserved is Surco's own write, not a newcomer: an export renames
// the track in place and holds the job open through the Apple Music add, so the watcher
// sees the new name seconds before the renderer's row learns it.
export function onWatchedFilesChanged(
  mediaAccess: MediaAccess,
  isReserved: (path: string) => boolean,
  send: (root: string, files: string[]) => void,
  root: string,
  files: string[],
): void {
  const others = files.filter((p) => !isReserved(p))
  mediaAccess.allowAll(others)
  send(root, others)
}
