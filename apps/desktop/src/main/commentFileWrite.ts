import { type CommentMode, phrasedComment } from '../shared/phraseCount'
import type { FieldWrite, TagFieldChange } from './tagFieldSet'

export interface CommentFileDeps {
  allowed: (path: string) => boolean
  readComment: (path: string) => Promise<string>
  mtime: (path: string) => Promise<number>
  rewrite: (path: string, changes: TagFieldChange[]) => Promise<{ outcomes: FieldWrite[] }>
  carry: (path: string, from: number, to: number) => Promise<void>
  noteWritten: (path: string) => Promise<unknown>
}

export async function writeCommentToFile(
  path: string,
  count: string,
  mode: CommentMode,
  deps: CommentFileDeps,
): Promise<boolean> {
  if (!deps.allowed(path)) return false
  try {
    const from = await deps.readComment(path)
    const to = phrasedComment(from, count, mode)
    if (to === from) return true
    const before = await deps.mtime(path)
    const { outcomes } = await deps.rewrite(path, [{ field: 'comment', from, to }])
    if (outcomes[0] !== 'written') return false
    await deps.carry(path, before, await deps.mtime(path))
    await deps.noteWritten(path)
    return true
  } catch {
    return false
  }
}
