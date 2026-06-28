// Of the audio files a watched folder now holds, the ones not already in the crate. The
// main process reports the folder's full current list on every change; the renderer owns the
// "what's actually new" decision because only it knows which paths the user already loaded
// (including files they dragged in individually, then later dropped the folder around).
const AUDIO_EXT = /\.(wav|flac|aif|aiff|mp3|m4a|mp4|aac|ogg|oga|opus)$/i

export function newTrackPaths(folderFiles: string[], loadedPaths: Iterable<string>): string[] {
  const loaded = new Set(loadedPaths)
  return folderFiles.filter((p) => AUDIO_EXT.test(p) && !loaded.has(p))
}
