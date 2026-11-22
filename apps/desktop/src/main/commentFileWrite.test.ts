import { describe, expect, it, vi } from 'vitest'
import { type CommentFileDeps, writeCommentToFile } from './commentFileWrite'

function deps(over: Partial<CommentFileDeps> = {}): CommentFileDeps {
  const mtimes = [1000, 2000]
  return {
    allowed: () => true,
    idle: async () => {},
    readComment: async () => 'Remix',
    mtime: async () => mtimes.shift() ?? 2000,
    rewrite: vi.fn(async () => ({ outcomes: ['written' as const] })),
    carry: vi.fn(async () => {}),
    noteWritten: vi.fn(async () => {}),
    ...over,
  }
}

describe('writeCommentToFile', () => {
  it('writes the composed comment over the one on disk and carries the analysis to the new date, so the track is not analysed again', async () => {
    const d = deps()
    expect(await writeCommentToFile('/m/a.wav', '2 - 8', 'prepend', d)).toBe(true)
    expect(d.rewrite).toHaveBeenCalledWith('/m/a.wav', [
      { field: 'comment', from: 'Remix', to: '2 - 8 · Remix' },
    ])
    expect(d.carry).toHaveBeenCalledWith('/m/a.wav', 1000, 2000)
    expect(d.noteWritten).toHaveBeenCalledWith('/m/a.wav')
  })

  it('notifies the new date only after the analysis is carried, so the window never asks for analysis under a date with none', async () => {
    const order: string[] = []
    const d = deps({
      carry: vi.fn(async () => {
        order.push('carry')
      }),
      noteWritten: vi.fn(async () => {
        order.push('noteWritten')
      }),
    })
    await writeCommentToFile('/m/a.wav', '2 - 8', 'prepend', d)
    expect(order).toEqual(['carry', 'noteWritten'])
  })

  it('waits for a Serato cue write on the same file before reading its comment, so neither rewrite erases the other', async () => {
    const order: string[] = []
    let release = () => {}
    const d = deps({
      idle: vi.fn(
        (p: string) =>
          new Promise<void>((resolve) => {
            order.push(`idle ${p}`)
            release = () => {
              order.push('serato done')
              resolve()
            }
          }),
      ),
      readComment: async () => {
        order.push('readComment')
        return 'Remix'
      },
    })
    const writing = writeCommentToFile('/m/a.mp3', '2 - 8', 'prepend', d)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(order).toEqual(['idle /m/a.mp3'])
    release()
    expect(await writing).toBe(true)
    expect(order).toEqual(['idle /m/a.mp3', 'serato done', 'readComment'])
  })

  it('writes a comment that has trailing spaces, since the file is read as it is held', async () => {
    const d = deps({ readComment: async () => 'Remix  ' })
    expect(await writeCommentToFile('/m/a.wav', '2 - 8', 'prepend', d)).toBe(true)
    expect(d.rewrite).toHaveBeenCalledWith('/m/a.wav', [
      { field: 'comment', from: 'Remix  ', to: '2 - 8 · Remix  ' },
    ])
  })

  it('refuses a file outside the folders Surco may touch, since a path from the window is not trusted', async () => {
    const d = deps({ allowed: () => false })
    expect(await writeCommentToFile('/etc/a.wav', '2 - 8', 'prepend', d)).toBe(false)
    expect(d.rewrite).not.toHaveBeenCalled()
  })

  it('reports a file whose comment changed under it as not written, so the window can say it was left alone', async () => {
    const d = deps({ rewrite: vi.fn(async () => ({ outcomes: ['unchanged' as const] })) })
    expect(await writeCommentToFile('/m/a.wav', '2 - 8', 'prepend', d)).toBe(false)
    expect(d.carry).not.toHaveBeenCalled()
  })

  it('does nothing when the comment already says it, so saving twice never touches the file', async () => {
    const d = deps({ readComment: async () => '2 - 8 · Remix' })
    expect(await writeCommentToFile('/m/a.wav', '2 - 8', 'prepend', d)).toBe(true)
    expect(d.rewrite).not.toHaveBeenCalled()
  })

  it('reports a rewrite that throws as not written, so one bad file does not stop the rest', async () => {
    const d = deps({
      rewrite: vi.fn(async () => {
        throw new Error('locked')
      }),
    })
    expect(await writeCommentToFile('/m/a.wav', '2 - 8', 'prepend', d)).toBe(false)
    expect(d.carry).not.toHaveBeenCalled()
  })
})
