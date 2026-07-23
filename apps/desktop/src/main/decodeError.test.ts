import { describe, expect, it } from 'vitest'
import { isPcmOverrun, slimDecodeError } from './decodeError'

// WHY these tests exist: execFile rejects with the child's ENTIRE stdout/stderr attached.
// For the PCM decoders that stdout is tens of MB of raw audio; the analysis handlers log
// those errors wholesale, and serializing one ~64 MB buffer froze the main process (macOS
// beachball) and timed out unrelated IPC (a Discogs search) while it churned. The slim
// copy must keep everything a log line needs and drop the payloads.
describe('slimDecodeError', () => {
  function execFileError(): Error & {
    code?: string
    cmd?: string
    killed?: boolean
    signal?: string
    stdout?: Buffer
    stderr?: Buffer
  } {
    const err = new Error('stdout maxBuffer length exceeded') as ReturnType<typeof execFileError>
    err.code = 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
    err.cmd = 'ffmpeg -i in.flac -f f32le -'
    err.killed = false
    err.stdout = Buffer.alloc(64 * 1024 * 1024)
    err.stderr = Buffer.from(`${'[flac] invalid sync code\n'.repeat(200)}tail-marker`)
    return err
  }

  it('drops the PCM payload entirely so logging the error stays cheap', () => {
    const slim = slimDecodeError(execFileError()) as { stdout?: unknown }
    expect(slim).not.toBe(undefined)
    expect('stdout' in (slim as object)).toBe(false)
  })

  it('keeps what a log line needs: message, code, cmd, killed/signal and the stack', () => {
    const original = execFileError()
    const slim = slimDecodeError(original) as Error & {
      code?: string
      cmd?: string
      killed?: boolean
      signal?: string
    }
    expect(slim).toBeInstanceOf(Error)
    expect(slim.message).toBe('stdout maxBuffer length exceeded')
    expect(slim.code).toBe('ERR_CHILD_PROCESS_STDIO_MAXBUFFER')
    expect(slim.cmd).toBe('ffmpeg -i in.flac -f f32le -')
    expect(slim.killed).toBe(false)
    expect(slim.stack).toBe(original.stack)
  })

  it('keeps only the head of stderr — the human-readable ffmpeg diagnosis, bounded', () => {
    const slim = slimDecodeError(execFileError()) as { stderr?: string }
    expect(typeof slim.stderr).toBe('string')
    expect(slim.stderr).toContain('invalid sync code')
    expect((slim.stderr as string).length).toBeLessThanOrEqual(2048)
  })

  it('returns errors without child output untouched, same reference', () => {
    const plain = new Error('ENOENT')
    expect(slimDecodeError(plain)).toBe(plain)
  })

  it('returns non-Error values untouched', () => {
    expect(slimDecodeError('boom')).toBe('boom')
    expect(slimDecodeError(undefined)).toBe(undefined)
  })
})

// WHY: a corrupt file (broken FLAC frame headers) garbles ffmpeg's timestamp accounting,
// so `-t 240` stops bounding the output and the decode overruns every maxBuffer ceiling —
// deterministically, on every retry. Detecting that exact failure lets bpm/key report the
// track as unmeasurable (a cacheable null) instead of re-decoding tens of MB per selection.
describe('isPcmOverrun', () => {
  it('recognizes the maxBuffer overrun code', () => {
    const err = Object.assign(new Error('stdout maxBuffer length exceeded'), {
      code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
    })
    expect(isPcmOverrun(err)).toBe(true)
  })

  it('rejects other decode failures so they stay retryable', () => {
    expect(isPcmOverrun(Object.assign(new Error('exit 1'), { code: 1 }))).toBe(false)
    expect(isPcmOverrun(new Error('ENOENT'))).toBe(false)
    expect(isPcmOverrun(null)).toBe(false)
    expect(isPcmOverrun(undefined)).toBe(false)
  })
})
