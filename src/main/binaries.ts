import { app } from 'electron'
import ffmpegStatic from 'ffmpeg-static'
import { path as ffprobeStaticPath } from 'ffprobe-static'

// ffmpeg/ffprobe are bundled with the app so a user never has to install them.
// They ship inside the asar archive, but native binaries can't be executed from
// there, so electron-builder unpacks them to app.asar.unpacked (see asarUnpack
// in electron-builder.yml). The paths the static packages compute still point at
// app.asar, so in a packaged build we have to remap them to the unpacked copy or
// the spawn fails with ENOENT.
export function unpacked(binaryPath: string, packaged: boolean): string {
  return packaged ? binaryPath.replace('app.asar', 'app.asar.unpacked') : binaryPath
}

export const ffmpegPath = unpacked(ffmpegStatic as unknown as string, app.isPackaged)
export const ffprobePath = unpacked(ffprobeStaticPath, app.isPackaged)
