import type { BrowserWindow, MessageBoxOptions } from 'electron'
import type { ApplyAnswer } from '../shared/djApi'
import type { CueProgram, DjProgram, WritableProgram } from '../shared/djProgram'
import { isEngineDjRunning, quitEngineDj } from './engineProcess'
import type { createMenuT } from './i18n'
import { isRekordboxRunning, quitRekordbox } from './rekordboxProcess'
import { isSeratoRunning, waitForSeratoExit } from './seratoProcess'
import { sharedPrompt } from './sharedPrompt'
import { isTraktorRunning, quitTraktor } from './traktorProcess'
import { isVirtualdjRunning, waitForVirtualdjExit } from './virtualdjProcess'

type MenuKey = Parameters<ReturnType<typeof createMenuT>>[0]

export type QuitReason = 'convert' | 'cues' | 'playlists' | 'usb' | 'restore' | 'duplicates'

export const QUIT_REASONS = {
  rekordbox: ['convert', 'playlists', 'usb', 'restore'],
  traktor: ['convert', 'cues', 'playlists', 'restore'],
  engine: ['convert', 'cues', 'playlists', 'usb', 'restore'],
  virtualdj: ['convert', 'restore', 'duplicates'],
} as const satisfies { [P in WritableProgram]: readonly ['convert', ...QuitReason[]] }

export type ReasonOf<P extends WritableProgram> = (typeof QUIT_REASONS)[P][number]

export interface ProgramProcess {
  isRunning: () => Promise<boolean>
  quit: () => Promise<boolean>
}

export const DJ_PROCESSES: Record<DjProgram, ProgramProcess> = {
  rekordbox: { isRunning: isRekordboxRunning, quit: () => quitRekordbox() },
  traktor: { isRunning: isTraktorRunning, quit: quitTraktor },
  engine: { isRunning: isEngineDjRunning, quit: quitEngineDj },
  serato: { isRunning: isSeratoRunning, quit: () => waitForSeratoExit() },
  virtualdj: { isRunning: isVirtualdjRunning, quit: () => waitForVirtualdjExit() },
}

export async function anyDjProgramRunning(
  processes: { [P in DjProgram]: Pick<ProgramProcess, 'isRunning'> } = DJ_PROCESSES,
): Promise<boolean> {
  const answers = await Promise.all(
    Object.values(processes).map((p) => p.isRunning().catch(() => false)),
  )
  return answers.some(Boolean)
}

export interface QuitText<P extends WritableProgram = WritableProgram> {
  message: Extract<MenuKey, `${P}QuitMessage`>
  confirm: Extract<MenuKey, `${P}QuitConfirm`>
  cancel: Extract<MenuKey, `${P}QuitCancel`>
  detail: Record<ReasonOf<P>, DetailKeyOf<P> | null>
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
      playlists: 'engineQuitDetailPlaylists',
      usb: 'engineQuitDetailUsb',
      restore: 'engineQuitDetailRestore',
    },
  },
  virtualdj: {
    message: 'virtualdjQuitMessage',
    confirm: 'virtualdjQuitConfirm',
    cancel: 'virtualdjQuitCancel',
    detail: {
      convert: null,
      restore: 'virtualdjQuitDetailRestore',
      duplicates: 'virtualdjQuitDetailDuplicates',
    },
  },
}

export type DetailKeyOf<P extends WritableProgram> = Extract<MenuKey, `${P}QuitDetail${string}`>

export function reasonOfDetail<P extends WritableProgram>(
  program: P,
  key: DetailKeyOf<P>,
): ReasonOf<P> {
  const text: QuitText<P> = QUIT_TEXT[program]
  const detail: Record<ReasonOf<P>, MenuKey | null> = text.detail
  const reason = (QUIT_REASONS[program] as readonly ReasonOf<P>[]).find((r) => detail[r] === key)
  if (reason === undefined) throw new Error(`No ${program} quit reason for ${key}`)
  return reason
}

export const QUIT_PROMPT_SHARING: Record<WritableProgram, 'once' | 'perReason'> = {
  rekordbox: 'perReason',
  traktor: 'once',
  engine: 'once',
  virtualdj: 'once',
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
    const detail = text.detail[reason]
    if (!detail) return false
    const response = await deps.ask(win, {
      type: 'warning',
      message: deps.t(text.message),
      detail: deps.t(detail),
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
    virtualdj: closer('virtualdj'),
  }

  return <P extends WritableProgram>(
    program: P,
    win: BrowserWindow | null,
    reason: ReasonOf<P> = 'convert',
  ) => closers[program](win, reason)
}

export type { ApplyAnswer }

const APPLY_TEXT = {
  rekordbox: {
    message: 'rekordboxQuitMessage',
    detail: 'rekordboxApplyDetail',
    now: 'rekordboxApplyNow',
  },
  traktor: { message: 'traktorQuitMessage', detail: 'traktorApplyDetail', now: 'traktorApplyNow' },
  engine: { message: 'engineQuitMessage', detail: 'engineApplyDetail', now: 'engineApplyNow' },
  serato: { message: 'seratoQuitMessage', detail: 'seratoApplyDetail', now: 'seratoApplyNow' },
  virtualdj: {
    message: 'virtualdjQuitMessage',
    detail: 'virtualdjApplyDetail',
    now: 'virtualdjApplyNow',
  },
} as const satisfies Record<CueProgram, { message: MenuKey; detail: MenuKey; now: MenuKey }>

export function createAskToApply(deps: {
  processes: Record<CueProgram, ProgramProcess>
  ask: (win: BrowserWindow | null, opts: MessageBoxOptions) => Promise<number>
  t: (key: MenuKey) => string
}): (program: CueProgram, win: BrowserWindow | null) => Promise<ApplyAnswer> {
  function asker(program: CueProgram) {
    const text = APPLY_TEXT[program]
    const prompt = sharedPrompt(async (_key: null, win: BrowserWindow | null) => {
      const response = await deps.ask(win, {
        type: 'warning',
        message: deps.t(text.message),
        detail: deps.t(text.detail),
        buttons: [deps.t('applyLater'), deps.t(text.now)],
        defaultId: 0,
        cancelId: 0,
      })
      if (response !== 1) return false
      return deps.processes[program].quit()
    })
    return async (win: BrowserWindow | null): Promise<ApplyAnswer> => {
      const running = await deps.processes[program].isRunning().catch(() => true)
      if (!running) return 'now'
      return (await prompt(null, win)) ? 'now' : 'later'
    }
  }

  const askers: Record<CueProgram, (win: BrowserWindow | null) => Promise<ApplyAnswer>> = {
    rekordbox: asker('rekordbox'),
    traktor: asker('traktor'),
    engine: asker('engine'),
    serato: asker('serato'),
    virtualdj: asker('virtualdj'),
  }

  return (program, win) => askers[program](win)
}
