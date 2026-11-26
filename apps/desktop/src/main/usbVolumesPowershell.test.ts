import { describe, expect, it, vi } from 'vitest'

const execFile = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ execFile }))

import { powershellQuery } from './usbVolumes'

// PowerShell never runs here: execFile answers in its place, so the test needs no Windows box.
function answer(result: { stdout: string } | Error): void {
  execFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: unknown) => {
    const done = cb as (err: Error | null, out?: { stdout: string }) => void
    if (result instanceof Error) done(result)
    else done(null, result)
  })
}

function commandRun(): string {
  const args = execFile.mock.calls.at(-1)?.[1] as string[]
  return Buffer.from(args[args.indexOf('-EncodedCommand') + 1], 'base64').toString('utf16le')
}

describe('powershellQuery', () => {
  // A profile or the execution policy on the DJ's PC must not change or block what the
  // export reads, and a console window flashing up on every stick check reads as malware.
  it('runs the volumes script without profile or policy and with no window', async () => {
    answer({ stdout: '[]' })
    await powershellQuery()
    const [cmd, args, opts] = execFile.mock.calls.at(-1) ?? []
    expect(cmd).toBe('powershell.exe')
    expect(args.slice(0, 5)).toEqual([
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
    ])
    expect(opts).toEqual({ windowsHide: true, maxBuffer: 1 << 20 })
    expect(commandRun()).toContain('Get-CimInstance -ClassName Win32_Volume')
    expect(commandRun().trimEnd().endsWith('}')).toBe(true)
  })

  it('answers the volumes PowerShell lists', async () => {
    const volumes = [{ DeviceID: '\\\\?\\Volume{abc}\\', DriveLetter: 'E:' }]
    answer({ stdout: `${JSON.stringify(volumes)}\r\n` })
    expect(await powershellQuery()).toEqual(volumes)
  })

  // Asked right before writing: the check is for that one drive, so another stick mounted
  // since must not answer for it.
  it('asks for just the drive letter it is given', async () => {
    answer({ stdout: '{}' })
    await powershellQuery('E:')
    expect(commandRun().endsWith("} 'E:'")).toBe(true)
  })

  // The letter is spliced into the command; anything but a bare letter could run whatever
  // it carries.
  it('never splices anything but a drive letter into the command', async () => {
    answer({ stdout: '[]' })
    await powershellQuery("E:'; Remove-Item C:\\ -Recurse; '")
    expect(commandRun().trimEnd().endsWith('}')).toBe(true)
    expect(commandRun()).not.toContain('Remove-Item')
  })

  // No stick list is better than a crashed export: with no PowerShell, a policy that blocks
  // it or no volumes printed, the export just offers no stick.
  it('answers no volumes when PowerShell fails, prints nothing or prints garbage', async () => {
    answer(new Error('spawn powershell.exe ENOENT'))
    expect(await powershellQuery()).toEqual([])
    answer({ stdout: '  \r\n' })
    expect(await powershellQuery()).toEqual([])
    answer({ stdout: 'WARNING: something' })
    expect(await powershellQuery()).toEqual([])
  })
})
