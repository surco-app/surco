import type { MediaAccess } from './mediaAccess'

// What a folder watcher does when it spots late-arriving tracks: grant them media access,
// THEN tell the renderer. The grant is the easy-to-forget half — the surco:// handler 403s
// any path the app never registered, so a watched track would be added to the list and shown
// in the player yet refuse to play. Normal imports (files:pick / files:expand) register their
// paths the same way; the watcher must too.
export function onWatchedFilesChanged(
  mediaAccess: MediaAccess,
  send: (root: string, files: string[]) => void,
  root: string,
  files: string[],
): void {
  mediaAccess.allowAll(files)
  send(root, files)
}
