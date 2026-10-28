import { ipcMain } from 'electron'
import type { CueProfileRead, TasteTrack } from '../shared/cueProfile'
import type { CueTaste } from './cueTaste'

export function registerCueTasteIpc(host: {
  taste: CueTaste
  marked: () => number | Promise<number>
  learnFromEdits: () => boolean
}): void {
  ipcMain.handle(
    'cues:profile',
    async (): Promise<CueProfileRead> => ({
      profile: host.taste.profile(),
      edits: host.taste.edits(),
      marked: await host.marked(),
    }),
  )
  ipcMain.handle('cues:learn', () => host.taste.learn())
  ipcMain.handle('cues:recordEdit', (_e, track: TasteTrack) =>
    host.taste.record(track, host.learnFromEdits()),
  )
}
