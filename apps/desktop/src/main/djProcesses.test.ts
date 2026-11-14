import type { BrowserWindow } from 'electron'
import { describe, expect, it, vi } from 'vitest'

vi.mock('./virtualdjProcess', async (original) => ({
  ...(await original<typeof import('./virtualdjProcess')>()),
  waitForVirtualdjExit: vi.fn(async () => true),
}))

import type { CueProgram, WritableProgram } from '../shared/djProgram'
import {
  anyDjProgramRunning,
  askInOrder,
  createAskToApply,
  createEnsureClosed,
  DJ_PROCESSES,
  type ProgramProcess,
  QUIT_REASONS,
  QUIT_TEXT,
  reasonOfDetail,
} from './djProcesses'
import { createMenuT } from './i18n'
import { isVirtualdjRunning, waitForVirtualdjExit } from './virtualdjProcess'

function deferred<T>() {
  let resolve: (v: T) => void = () => {}
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function fakeProcess(running: boolean, closes = true) {
  return {
    isRunning: vi.fn(async () => running),
    quit: vi.fn(async () => closes),
  }
}

function setup(
  overrides: Partial<Record<WritableProgram, ReturnType<typeof fakeProcess>>> = {},
  ask: (win: unknown, opts: { detail?: string }) => Promise<number> = async () => 0,
) {
  const processes = {
    rekordbox: overrides.rekordbox ?? fakeProcess(true),
    traktor: overrides.traktor ?? fakeProcess(true),
    engine: overrides.engine ?? fakeProcess(true),
    virtualdj: overrides.virtualdj ?? fakeProcess(true),
  } satisfies Record<WritableProgram, ProgramProcess>
  const askSpy = vi.fn(ask)
  const t = (key: string) => `t:${key}`
  const ensureClosed = createEnsureClosed({ processes, ask: askSpy, t })
  return { processes, ask: askSpy, ensureClosed }
}

const win = { id: 1 } as unknown as BrowserWindow

describe('createEnsureClosed', () => {
  it('lets a write through without asking when the program is closed', async () => {
    const traktor = fakeProcess(false)
    const { ask, ensureClosed } = setup({ traktor })
    expect(await ensureClosed('traktor', win)).toBe(true)
    expect(ask).not.toHaveBeenCalled()
    expect(traktor.quit).not.toHaveBeenCalled()
  })

  it('refuses the write and leaves the program open when the user declines', async () => {
    const engine = fakeProcess(true)
    const { ensureClosed } = setup({ engine }, async () => 1)
    expect(await ensureClosed('engine', win)).toBe(false)
    expect(engine.quit).not.toHaveBeenCalled()
  })

  it('closes the program when the user accepts and reports whether it closed', async () => {
    const stuck = fakeProcess(true, false)
    const failing = setup({ rekordbox: stuck }, async () => 0)
    expect(await failing.ensureClosed('rekordbox', win)).toBe(false)
    expect(stuck.quit).toHaveBeenCalledTimes(1)

    const closing = fakeProcess(true, true)
    const succeeding = setup({ rekordbox: closing }, async () => 0)
    expect(await succeeding.ensureClosed('rekordbox', win)).toBe(true)
    expect(closing.quit).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['traktor', 'convert', 'restore', 't:traktorQuitDetail'],
    ['engine', 'convert', 'usb', 't:engineQuitDetail'],
  ] as const)(
    "asks %s once for two writes that arrive together, in the first one's words",
    async (program, firstReason, secondReason, firstDetail) => {
      const answer = deferred<number>()
      const { ask, ensureClosed } = setup({}, () => answer.promise)
      const first = ensureClosed(program, win, firstReason as never)
      const second = ensureClosed(program, win, secondReason as never)
      await vi.waitFor(() => expect(ask).toHaveBeenCalledTimes(1))
      answer.resolve(1)
      expect(await Promise.all([first, second])).toEqual([false, false])
      expect(ask).toHaveBeenCalledTimes(1)
      expect(ask.mock.calls[0][1].detail).toBe(firstDetail)
    },
  )

  it.each(['traktor', 'engine'] as const)(
    'lets a second %s write through without waiting when the program closed while the first was asking',
    async (program) => {
      const answer = deferred<number>()
      const process = fakeProcess(true)
      const { ask, ensureClosed } = setup({ [program]: process }, () => answer.promise)
      const first = ensureClosed(program, win)
      await vi.waitFor(() => expect(ask).toHaveBeenCalledTimes(1))
      process.isRunning.mockResolvedValue(false)
      expect(await ensureClosed(program, win)).toBe(true)
      answer.resolve(1)
      expect(await first).toBe(false)
      expect(process.isRunning).toHaveBeenCalledTimes(2)
    },
  )

  it('asks rekordbox again in its own words for a second write of another kind', async () => {
    const firstAnswer = deferred<number>()
    const rekordbox = fakeProcess(true)
    const { ask, ensureClosed } = setup({ rekordbox }, (_win, opts) =>
      opts.detail === 't:rekordboxQuitDetail' ? firstAnswer.promise : Promise.resolve(1),
    )
    const conversion = ensureClosed('rekordbox', win, 'convert')
    const playlists = ensureClosed('rekordbox', win, 'usb')
    await vi.waitFor(() => expect(ask).toHaveBeenCalledTimes(1))
    await new Promise((r) => setTimeout(r, 0))
    expect(ask).toHaveBeenCalledTimes(1)
    expect(rekordbox.isRunning).toHaveBeenCalledTimes(1)
    rekordbox.quit.mockResolvedValue(false)
    firstAnswer.resolve(0)
    expect(await conversion).toBe(false)
    expect(await playlists).toBe(false)
    expect(ask).toHaveBeenCalledTimes(2)
    expect(ask.mock.calls[0][1].detail).toBe('t:rekordboxQuitDetail')
    expect(ask.mock.calls[1][1].detail).toBe('t:rekordboxQuitDetailUsb')
    expect(rekordbox.isRunning).toHaveBeenCalledTimes(2)
  })

  it('asks rekordbox once for two writes of the same kind', async () => {
    const answer = deferred<number>()
    const rekordbox = fakeProcess(true)
    const { ask, ensureClosed } = setup({ rekordbox }, () => answer.promise)
    const first = ensureClosed('rekordbox', win, 'usb')
    const second = ensureClosed('rekordbox', win, 'usb')
    await vi.waitFor(() => expect(ask).toHaveBeenCalledTimes(1))
    answer.resolve(0)
    expect(await Promise.all([first, second])).toEqual([true, true])
    expect(ask).toHaveBeenCalledTimes(1)
    expect(rekordbox.quit).toHaveBeenCalledTimes(1)
  })

  const words = {
    rekordbox: {
      convert: 'rekordboxQuitDetail',
      usb: 'rekordboxQuitDetailUsb',
      restore: 'rekordboxQuitDetailRestore',
    },
    traktor: {
      convert: 'traktorQuitDetail',
      restore: 'traktorQuitDetailRestore',
    },
    engine: {
      convert: 'engineQuitDetail',
      usb: 'engineQuitDetailUsb',
      restore: 'engineQuitDetailRestore',
    },
  } as const

  it('gives each program the reasons it has words for today', () => {
    expect(QUIT_REASONS).toEqual({
      rekordbox: ['convert', 'usb', 'restore'],
      traktor: ['convert', 'restore'],
      engine: ['convert', 'usb', 'restore'],
      virtualdj: ['convert', 'restore', 'duplicates'],
    })
  })

  it('asks the DJ to close VirtualDJ before a restore, and only checks that it closed', async () => {
    const virtualdj = fakeProcess(true, false)
    const { ask, ensureClosed } = setup({ virtualdj })
    expect(await ensureClosed('virtualdj', win, 'restore')).toBe(false)
    expect(ask).toHaveBeenCalledWith(win, {
      type: 'warning',
      message: 't:virtualdjQuitMessage',
      detail: 't:virtualdjQuitDetailRestore',
      buttons: ['t:virtualdjQuitConfirm', 't:virtualdjQuitCancel'],
      defaultId: 0,
      cancelId: 1,
    })
    expect(virtualdj.quit).toHaveBeenCalledTimes(1)
  })

  it('never asks VirtualDJ to quit, since its writes wait in its queue until it closes', async () => {
    const virtualdj = fakeProcess(true)
    const { ask, ensureClosed } = setup({ virtualdj })
    expect(await ensureClosed('virtualdj', win)).toBe(false)
    expect(ask).not.toHaveBeenCalled()
    expect(virtualdj.quit).not.toHaveBeenCalled()
    virtualdj.isRunning.mockResolvedValue(false)
    expect(await ensureClosed('virtualdj', win)).toBe(true)
  })

  it.each(
    (Object.keys(words) as (keyof typeof words)[]).flatMap((program) =>
      Object.entries(words[program]).map(([reason, detail]) => [program, reason, detail] as const),
    ),
  )("uses each program's own words: %s %s", async (program, reason, detail) => {
    const { ask, ensureClosed } = setup({}, async () => 1)
    await ensureClosed(program, win, reason as never)
    expect(ask).toHaveBeenCalledWith(win, {
      type: 'warning',
      message: `t:${program}QuitMessage`,
      detail: `t:${detail}`,
      buttons: [`t:${program}QuitConfirm`, `t:${program}QuitCancel`],
      defaultId: 0,
      cancelId: 1,
    })
  })

  it('asks in the conversion words when no reason is given', async () => {
    const { ask, ensureClosed } = setup({}, async () => 1)
    await ensureClosed('engine', win)
    expect(ask.mock.calls[0][1].detail).toBe('t:engineQuitDetail')
  })

  it('opens the dialog without a parent when there is no window', async () => {
    const { ask, ensureClosed } = setup({}, async () => 1)
    await ensureClosed('traktor', null)
    expect(ask).toHaveBeenCalledTimes(1)
    expect(ask.mock.calls[0][0]).toBeNull()
  })

  it('refuses at compile time a reason the program has no words for', async () => {
    const { ensureClosed } = setup({ rekordbox: fakeProcess(false) })
    // @ts-expect-error
    await ensureClosed('rekordbox', null, 'cues')
  })
})

describe('reasonOfDetail', () => {
  it.each([
    ['rekordbox', 'rekordboxQuitDetailUsb', 'usb'],
    ['rekordbox', 'rekordboxQuitDetail', 'convert'],
    ['engine', 'engineQuitDetailUsb', 'usb'],
    ['engine', 'engineQuitDetailRestore', 'restore'],
    ['traktor', 'traktorQuitDetailRestore', 'restore'],
    ['virtualdj', 'virtualdjQuitDetailRestore', 'restore'],
    ['virtualdj', 'virtualdjQuitDetailDuplicates', 'duplicates'],
  ] as const)(
    'keeps the words a %s caller passes by asking for the reason behind %s',
    (program, key, reason) => {
      expect(reasonOfDetail(program, key)).toBe(reason)
    },
  )
  it('refuses a wording no reason uses', () => {
    expect(() => reasonOfDetail('rekordbox', 'rekordboxQuitDetailPlaylists' as never)).toThrow(
      'No rekordbox quit reason for rekordboxQuitDetailPlaylists',
    )
  })
})

describe('QUIT_TEXT', () => {
  it('refuses at compile time a wording that belongs to another program', () => {
    // @ts-expect-error
    const wrong: (typeof QUIT_TEXT)['engine']['detail']['usb'] = 'rekordboxQuitDetailUsb'
    expect(wrong).toBe('rekordboxQuitDetailUsb')
  })

  it('refuses at compile time a writable program with no quit wording, so it can never be closed without asking', () => {
    // @ts-expect-error
    const missing: typeof QUIT_TEXT = { ...QUIT_TEXT, virtualdj: null }
    expect(missing.virtualdj).toBeNull()
  })
})

describe('anyDjProgramRunning', () => {
  // The quality sweep keeps going while Surco sits behind another window and stops only
  // when a DJ program is open, the one moment ffmpeg could steal CPU from a set.
  const stopped = { isRunning: async () => false }
  const open = { isRunning: async () => true }
  it('is true when any of the programs is open', async () => {
    expect(
      await anyDjProgramRunning({
        rekordbox: stopped,
        traktor: stopped,
        engine: stopped,
        serato: open,
        virtualdj: stopped,
      }),
    ).toBe(true)
  })

  it('is true when only VirtualDJ is open, since a set in VirtualDJ needs the CPU as much', async () => {
    expect(
      await anyDjProgramRunning({
        rekordbox: stopped,
        traktor: stopped,
        engine: stopped,
        serato: stopped,
        virtualdj: open,
      }),
    ).toBe(true)
  })

  it('waits for VirtualDJ to exit once the DJ says it closed it, as the others wait for theirs', async () => {
    expect(await DJ_PROCESSES.virtualdj.quit()).toBe(true)
    expect(waitForVirtualdjExit).toHaveBeenCalledTimes(1)
  })

  it('asks the VirtualDJ process whether VirtualDJ is open', () => {
    expect(DJ_PROCESSES.virtualdj.isRunning).toBe(isVirtualdjRunning)
  })

  it('is false when none is open', async () => {
    expect(
      await anyDjProgramRunning({
        rekordbox: stopped,
        traktor: stopped,
        engine: stopped,
        serato: stopped,
        virtualdj: stopped,
      }),
    ).toBe(false)
  })
})

function askToApplyWith(opts: {
  running: boolean | 'throws'
  ask: (win: unknown, opts: unknown) => Promise<number>
  quit?: () => Promise<boolean>
}) {
  const process = {
    isRunning: async () => {
      if (opts.running === 'throws') throw new Error('probe failed')
      return opts.running
    },
    quit: opts.quit ?? (async () => true),
  }
  const processes: Record<CueProgram, ProgramProcess> = {
    rekordbox: process,
    traktor: process,
    engine: process,
    serato: process,
    virtualdj: process,
  }
  return createAskToApply({ processes, ask: opts.ask, t: createMenuT('es') })
}

describe('createAskToApply', () => {
  it('answers now without asking when the program is closed, so a closed program never shows a prompt', async () => {
    const ask = vi.fn()
    const answer = await askToApplyWith({ running: false, ask })('traktor', null)
    expect(answer).toBe('now')
    expect(ask).not.toHaveBeenCalled()
  })
  it('puts Apply when it closes first and as both Enter and Escape, so a habitual Enter never closes Traktor mid-set', async () => {
    const ask = vi.fn().mockResolvedValue(0)
    expect(await askToApplyWith({ running: true, ask })('traktor', null)).toBe('later')
    expect(ask.mock.calls[0][1]).toMatchObject({
      buttons: ['Aplicar al cerrarlo', 'Cerrar Traktor y aplicar'],
      defaultId: 0,
      cancelId: 0,
    })
  })
  it('closes the program and answers now when the DJ picks Close and apply', async () => {
    const quit = vi.fn().mockResolvedValue(true)
    expect(
      await askToApplyWith({ running: true, ask: async () => 1, quit })('rekordbox', null),
    ).toBe('now')
    expect(quit).toHaveBeenCalledOnce()
  })
  it('answers later when the program would not close, so the change waits instead of being lost', async () => {
    expect(
      await askToApplyWith({ running: true, ask: async () => 1, quit: async () => false })(
        'virtualdj',
        null,
      ),
    ).toBe('later')
  })
  it('answers later when closing the program throws, so the DJ action still goes on and the change waits', async () => {
    const quit = async () => {
      throw new Error('quit failed')
    }
    expect(await askToApplyWith({ running: true, ask: async () => 1, quit })('traktor', null)).toBe(
      'later',
    )
  })
  it('asks when the running check fails, as the quiet path counts it as open', async () => {
    const ask = vi.fn().mockResolvedValue(0)
    await askToApplyWith({ running: 'throws', ask })('engine', null)
    expect(ask).toHaveBeenCalledOnce()
  })
  it('shares one prompt between two asks for the same program at once', async () => {
    const ask = vi.fn().mockResolvedValue(0)
    const asker = askToApplyWith({ running: true, ask })
    await Promise.all([asker('traktor', null), asker('traktor', null)])
    expect(ask).toHaveBeenCalledOnce()
  })
  it('offers I closed it, apply for Serato and VirtualDJ, which Surco cannot close itself', async () => {
    const ask = vi.fn().mockResolvedValue(0)
    await askToApplyWith({ running: true, ask })('serato', null)
    expect(ask.mock.calls[0][1].buttons).toEqual(['Aplicar al cerrarlo', 'Lo he cerrado, aplicar'])
  })
})

describe('askInOrder', () => {
  it('asks the programs one after another in the given order, so two prompts never stack, and collects each answer', async () => {
    const win = {} as BrowserWindow
    const first = deferred<'now' | 'later'>()
    const second = deferred<'now' | 'later'>()
    const pending: Record<CueProgram, Promise<'now' | 'later'>> = {
      traktor: first.promise,
      serato: second.promise,
      rekordbox: Promise.resolve('now'),
      engine: Promise.resolve('now'),
      virtualdj: Promise.resolve('now'),
    }
    const asked: CueProgram[] = []
    const asker = vi.fn((program: CueProgram, _win: BrowserWindow | null) => {
      asked.push(program)
      return pending[program]
    })
    const answers = askInOrder(asker, ['traktor', 'serato'], win)
    await Promise.resolve()
    expect(asked).toEqual(['traktor'])
    first.resolve('later')
    await vi.waitFor(() => expect(asked).toEqual(['traktor', 'serato']))
    second.resolve('now')
    expect(await answers).toEqual({ traktor: 'later', serato: 'now' })
    expect(asker).toHaveBeenCalledWith('traktor', win)
    expect(asker).toHaveBeenCalledWith('serato', win)
  })
})
