import type { BrowserWindow, MessageBoxOptions } from 'electron'
import type { DjProgram, WritableProgram } from '../shared/djProgram'
import { isEngineDjRunning, quitEngineDj } from './engineProcess'
import type { createMenuT } from './i18n'
import { isRekordboxRunning, quitRekordbox } from './rekordboxProcess'
import { isSeratoRunning } from './seratoProcess'
import { sharedPrompt } from './sharedPrompt'
import { isTraktorRunning, quitTraktor } from './traktorProcess'

type MenuKey = Parameters<ReturnType<typeof createMenuT>>[0]

export type QuitReason = 'convert' | 'cues' | 'playlists' | 'usb' | 'restore'

export const QUIT_REASONS = {
  rekordbox: ['convert', 'playlists', 'usb', 'restore'],
  traktor: ['convert', 'cues', 'playlists', 'restore'],
  engine: ['convert', 'cues', 'usb', 'restore'],
} as const satisfies { [P in WritableProgram]: readonly ['convert', ...QuitReason[]] }

export type ReasonOf<P extends WritableProgram> = (typeof QUIT_REASONS)[P][number]

export interface ProgramProcess {
  isRunning: () => Promise<boolean>
  quit: () => Promise<boolean>
}

export const DJ_PROCESSES: {
  [P in DjProgram]: P extends WritableProgram ? ProgramProcess : Pick<ProgramProcess, 'isRunning'>
} = {
  rekordbox: { isRunning: isRekordboxRunning, quit: () => quitRekordbox() },
  traktor: { isRunning: isTraktorRunning, quit: quitTraktor },
  engine: { isRunning: isEngineDjRunning, quit: quitEngineDj },
  serato: { isRunning: isSeratoRunning },
}

export interface QuitText<P extends WritableProgram = WritableProgram> {
  message: Extract<MenuKey, `${P}QuitMessage`>
  confirm: Extract<MenuKey, `${P}QuitConfirm`>
  cancel: Extract<MenuKey, `${P}QuitCancel`>
  detail: Record<ReasonOf<P>, DetailKeyOf<P>>
}

export const QUIT_TEXT: { [P in WritableProgram]: QuitText<P> } = {
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

export type DetailKeyOf<P extends WritableProgram> = Extract<MenuKey, `${P}QuitDetail${string}`>

export function reasonOfDetail<P extends WritableProgram>(
  program: P,
  key: DetailKeyOf<P>,
): ReasonOf<P> {
  const detail: Record<ReasonOf<P>, MenuKey> = QUIT_TEXT[program].detail
  const reason = (QUIT_REASONS[program] as readonly ReasonOf<P>[]).find((r) => detail[r] === key)
  if (reason === undefined) throw new Error(`No ${program} quit reason for ${key}`)
  return reason
}

export const QUIT_PROMPT_SHARING: Record<WritableProgram, 'once' | 'perReason'> = {
  rekordbox: 'perReason',
  traktor: 'once',
  engine: 'once',
}

export function createEnsureClosed(deps: {
  processes: Record<WritableProgram, ProgramProcess>
  ask: (win: BrowserWindow | null, opts: MessageBoxOptions) => Promise<number>
  t: (key: MenuKey) => string
}): <P extends WritableProgram>(
  program: P,
  win: BrowserWindow | null,
  reason?: ReasonOf<P>,
) => Promise<boolean> {
  async function askToClose<P extends WritableProgram>(
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

  function closer<P extends WritableProgram>(program: P) {
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
    [P in WritableProgram]: (win: BrowserWindow | null, reason: ReasonOf<P>) => Promise<boolean>
  } = {
    rekordbox: closer('rekordbox'),
    traktor: closer('traktor'),
    engine: closer('engine'),
  }

  return <P extends WritableProgram>(
    program: P,
    win: BrowserWindow | null,
    reason: ReasonOf<P> = 'convert',
  ) => closers[program](win, reason)
}
