import type { BrowserWindow, MessageBoxOptions } from 'electron'
import type { DjProgram } from '../shared/djProgram'
import { isEngineDjRunning, quitEngineDj } from './engineProcess'
import type { createMenuT } from './i18n'
import { isRekordboxRunning, quitRekordbox } from './rekordboxProcess'
import { sharedPrompt } from './sharedPrompt'
import { isTraktorRunning, quitTraktor } from './traktorProcess'

type MenuKey = Parameters<ReturnType<typeof createMenuT>>[0]

export type QuitReason = 'convert' | 'cues' | 'playlists' | 'usb' | 'restore'

export const QUIT_REASONS = {
  rekordbox: ['convert', 'playlists', 'usb', 'restore'],
  traktor: ['convert', 'cues', 'playlists', 'restore'],
  engine: ['convert', 'cues', 'usb', 'restore'],
} as const satisfies { [P in DjProgram]: readonly QuitReason[] }

export type ReasonOf<P extends DjProgram> = (typeof QUIT_REASONS)[P][number]

export const DJ_PROCESSES: Record<
  DjProgram,
  { isRunning: () => Promise<boolean>; quit: () => Promise<boolean> }
> = {
  rekordbox: { isRunning: isRekordboxRunning, quit: () => quitRekordbox() },
  traktor: { isRunning: isTraktorRunning, quit: quitTraktor },
  engine: { isRunning: isEngineDjRunning, quit: quitEngineDj },
}

export interface QuitText<P extends DjProgram = DjProgram> {
  message: MenuKey
  confirm: MenuKey
  cancel: MenuKey
  detail: Record<ReasonOf<P>, MenuKey>
}

export const QUIT_TEXT: { [P in DjProgram]: QuitText<P> } = {
  rekordbox: {
    message: 'rekordboxQuitMessage',
    confirm: 'rekordboxQuitConfirm',
    cancel: 'rekordboxQuitCancel',
    detail: {
      convert: 'rekordboxQuitDetail',
      playlists: 'rekordboxQuitDetailPlaylists',
      usb: 'rekordboxQuitDetailUsb',
      restore: 'rekordboxQuitDetailRestore',
    },
  },
  traktor: {
    message: 'traktorQuitMessage',
    confirm: 'traktorQuitConfirm',
    cancel: 'traktorQuitCancel',
    detail: {
      convert: 'traktorQuitDetail',
      cues: 'traktorQuitDetailCues',
      playlists: 'traktorQuitDetailPlaylists',
      restore: 'traktorQuitDetailRestore',
    },
  },
  engine: {
    message: 'engineQuitMessage',
    confirm: 'engineQuitConfirm',
    cancel: 'engineQuitCancel',
    detail: {
      convert: 'engineQuitDetail',
      cues: 'engineQuitDetailCues',
      usb: 'engineQuitDetailUsb',
      restore: 'engineQuitDetailRestore',
    },
  },
}

export const QUIT_PROMPT_SHARING: Record<DjProgram, 'once' | 'perReason'> = {
  rekordbox: 'perReason',
  traktor: 'once',
  engine: 'once',
}

export function createEnsureClosed(deps: {
  processes: typeof DJ_PROCESSES
  ask: (win: BrowserWindow | null, opts: MessageBoxOptions) => Promise<number>
  t: (key: MenuKey) => string
}): <P extends DjProgram>(
  program: P,
  win: BrowserWindow | null,
  reason?: ReasonOf<P>,
) => Promise<boolean> {
  async function askToClose<P extends DjProgram>(
    program: P,
    win: BrowserWindow | null,
    reason: ReasonOf<P>,
  ): Promise<boolean> {
    const text: QuitText<P> = QUIT_TEXT[program]
    const response = await deps.ask(win, {
      type: 'warning',
      message: deps.t(text.message),
      detail: deps.t(text.detail[reason]),
      buttons: [deps.t(text.confirm), deps.t(text.cancel)],
      defaultId: 0,
      cancelId: 1,
    })
    if (response !== 0) return false
    return deps.processes[program].quit()
  }

  function closer<P extends DjProgram>(program: P) {
    const { isRunning } = deps.processes[program]
    const perReason = QUIT_PROMPT_SHARING[program] === 'perReason'
    const prompt = sharedPrompt(
      async (_key: ReasonOf<P> | null, win: BrowserWindow | null, reason: ReasonOf<P>) => {
        if (perReason && !(await isRunning())) return true
        return askToClose(program, win, reason)
      },
    )
    return async (win: BrowserWindow | null, reason: ReasonOf<P>): Promise<boolean> => {
      if (perReason) return prompt(reason, win, reason)
      if (!(await isRunning())) return true
      return prompt(null, win, reason)
    }
  }

  const closers: {
    [P in DjProgram]: (win: BrowserWindow | null, reason: ReasonOf<P>) => Promise<boolean>
  } = {
    rekordbox: closer('rekordbox'),
    traktor: closer('traktor'),
    engine: closer('engine'),
  }

  return <P extends DjProgram>(
    program: P,
    win: BrowserWindow | null,
    reason: ReasonOf<P> = 'convert',
  ) => closers[program](win, reason)
}
