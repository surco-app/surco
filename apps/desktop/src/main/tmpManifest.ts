// convertAudio writes its temp file beside the user's own output — anywhere on
// disk, in-place edits included, never in the OS tmpdir — so a crash or
// force-quit mid-write leaves a `Song.tmp-a1b2c3d4.aiff` there forever with no
// OS purge to eventually clean it up (Windows in particular never touches
// %TEMP% on its own). This manifest is what lets the next launch find and
// remove exactly the paths this app itself created, never a glob over the
// user's music folders.
export interface FsAdapter {
  readFileSync: (path: string) => string
  writeFileSync: (path: string, data: string) => void
  existsSync: (path: string) => boolean
  unlinkSync: (path: string) => void
}

export interface TmpManifest {
  track: (path: string) => void
  untrack: (path: string) => void
  // Deletes every path left over from a run that never got to untrack them
  // (crash, force-quit), then clears the manifest of everything it managed to
  // remove — a path it could not delete stays listed for the next sweep. Call
  // once at launch, before any new conversion starts.
  sweepOrphans: () => void
}

function readPaths(manifestPath: string, fs: FsAdapter): string[] {
  if (!fs.existsSync(manifestPath)) return []
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(manifestPath))
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : []
  } catch {
    // A corrupt manifest (partial write mid-crash) sweeps nothing rather than
    // throwing — the orphan(s) it would have named are stuck until the next
    // successful write names them again, which is a fine tradeoff for never
    // crashing launch over a broken JSON file.
    return []
  }
}

function writePaths(manifestPath: string, fs: FsAdapter, paths: string[]): void {
  fs.writeFileSync(manifestPath, JSON.stringify(paths))
}

export function createTmpManifest(manifestPath: string, fs: FsAdapter): TmpManifest {
  return {
    track: (path) => {
      const paths = readPaths(manifestPath, fs)
      paths.push(path)
      writePaths(manifestPath, fs, paths)
    },
    untrack: (path) => {
      const paths = readPaths(manifestPath, fs).filter((p) => p !== path)
      writePaths(manifestPath, fs, paths)
    },
    sweepOrphans: () => {
      const paths = readPaths(manifestPath, fs)
      // Paths still on disk after this pass. A delete that fails for anything other
      // than "already gone" means the file is still there — a network volume holding
      // the handle, or a Windows scanner — and the manifest is the only thing that
      // will ever lead a later sweep back to it. Clearing it regardless was what left
      // half-written temps parked in the user's own folder with no record anywhere.
      const kept: string[] = []
      for (const path of paths) {
        try {
          fs.unlinkSync(path)
        } catch (e) {
          // ENOENT is the sweep succeeding by other means (user deleted it, or the
          // crash happened before ffmpeg created it): nothing to chase next time.
          if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') kept.push(path)
        }
      }
      if (paths.length) writePaths(manifestPath, fs, kept)
    },
  }
}
