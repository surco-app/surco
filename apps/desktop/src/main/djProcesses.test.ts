import type { BrowserWindow } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { WritableProgram } from '../shared/djProgram'
import {
  anyDjProgramRunning,
  createEnsureClosed,
  DJ_PROCESSES,
  type ProgramProcess,
  QUIT_REASONS,
  type QUIT_TEXT,
  reasonOfDetail,
} from './djProcesses'
import { isVirtualdjRunning } from './virtualdjProcess'

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
    ['traktor', 'cues', 'playlists', 't:traktorQuitDetailCues'],
    ['engine', 'cues', 'usb', 't:engineQuitDetailCues'],
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
    const playlists = ensureClosed('rekordbox', win, 'playlists')
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
    expect(ask.mock.calls[1][1].detail).toBe('t:rekordboxQuitDetailPlaylists')
    expect(rekordbox.isRunning).toHaveBeenCalledTimes(2)
  })

  it('asks rekordbox once for two writes of the same kind', async () => {
    const answer = deferred<number>()
    const rekordbox = fakeProcess(true)
    const { ask, ensureClosed } = setup({ rekordbox }, () => answer.promise)
    const first = ensureClosed('rekordbox', win, 'playlists')
    const second = ensureClosed('rekordbox', win, 'playlists')
    await vi.waitFor(() => expect(ask).toHaveBeenCalledTimes(1))
    answer.resolve(0)
    expect(await Promise.all([first, second])).toEqual([true, true])
    expect(ask).toHaveBeenCalledTimes(1)
    expect(rekordbox.quit).toHaveBeenCalledTimes(1)
  })

  const words = {
    rekordbox: {
      convert: 'rekordboxQuitDetail',
      playlists: 'rekordboxQuitDetailPlaylists',
      usb: 'rekordboxQuitDetailUsb',
      restore: 'rekordboxQuitDetailRestore',
    },
    traktor: {
      convert: 'traktorQuitDetail',
      cues: 'traktorQuitDetailCues',
      playlists: 'traktorQuitDetailPlaylists',
      restore: 'traktorQuitDetailRestore',
    },
    engine: {
      convert: 'engineQuitDetail',
      cues: 'engineQuitDetailCues',
      playlists: 'engineQuitDetailPlaylists',
      usb: 'engineQuitDetailUsb',
      restore: 'engineQuitDetailRestore',
    },
  } as const

  it('gives each program the reasons it has words for today', () => {
    expect(QUIT_REASONS).toEqual({
      rekordbox: ['convert', 'playlists', 'usb', 'restore'],
      traktor: ['convert', 'cues', 'playlists', 'restore'],
      engine: ['convert', 'cues', 'playlists', 'usb', 'restore'],
    })
  })

  it.each(
    (Object.keys(words) as WritableProgram[]).flatMap((program) =>
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
    ['traktor', 'traktorQuitDetailCues', 'cues'],
    ['traktor', 'traktorQuitDetailPlaylists', 'playlists'],
  ] as const)(
    'keeps the words a %s caller passes by asking for the reason behind %s',
    (program, key, reason) => {
      expect(reasonOfDetail(program, key)).toBe(reason)
    },
  )
  it('refuses a wording no reason uses', () => {
    expect(() => reasonOfDetail('rekordbox', 'rekordboxQuitDetailCues' as never)).toThrow(
      'No rekordbox quit reason for rekordboxQuitDetailCues',
    )
  })
})

describe('QUIT_TEXT', () => {
  it('refuses at compile time a wording that belongs to another program', () => {
    // @ts-expect-error
    const wrong: (typeof QUIT_TEXT)['engine']['detail']['cues'] = 'traktorQuitDetailCues'
    expect(wrong).toBe('traktorQuitDetailCues')
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
