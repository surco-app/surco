import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const SET_ICON = `ObjC.import('AppKit')
function run(argv) {
  const image = $.NSImage.alloc.initWithContentsOfFile(argv[1])
  if (!$.NSWorkspace.sharedWorkspace.setIconForFileOptions(image, argv[0], 0)) throw new Error('setIcon failed')
}`

// macOS Finder and QuickLook never read FLAC's own PICTURE block, so a FLAC with
// perfectly good embedded art shows a generic icon. A custom Finder icon lives in the
// file's extended attributes rather than its bytes, so the FLAC stays standard and
// Traktor keeps it, which the ID3 header this replaced did not.
export async function setFinderIcon(file: string, imagePath: string): Promise<void> {
  await execFileAsync('osascript', ['-l', 'JavaScript', '-e', SET_ICON, file, imagePath])
}
