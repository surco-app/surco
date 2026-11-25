import {
  Braces,
  ClipboardCopy,
  ClipboardPaste,
  Copy,
  Folder,
  Globe,
  Link,
  Undo2,
} from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { type MoreItemsContext, moreItems } from './metaMenu'

describe('moreItems', () => {
  const tr = i18n.getFixedT('en')
  const ctx = (over: Partial<MoreItemsContext> = {}): MoreItemsContext => ({
    isMulti: false,
    tr,
    revealKey: 'commands.reveal',
    icons: { Folder, Copy, Link, Globe, Braces, ClipboardCopy, ClipboardPaste, Undo2 },
    onReveal: vi.fn(),
    onCopyFilename: vi.fn(),
    onCopyPath: vi.fn(),
    onSearchWeb: vi.fn(),
    onApplyTitleFormat: undefined,
    titleFormat: '',
    onCopyMeta: vi.fn(),
    onPasteMeta: vi.fn(),
    copiedMetaTitle: null,
    restorableRelease: {},
    restoreRelease: vi.fn(),
    ...over,
  })
  const ids = (c: MoreItemsContext) => moreItems(c).map((i) => i.id)

  it('lists the file actions, copy and paste for one track', () => {
    expect(ids(ctx())).toEqual([
      'reveal',
      'copy-filename',
      'copy-path',
      'search-web',
      'copy-meta',
      'paste-meta',
    ])
  })

  // A selection has no single file to reveal or copy, and no one set of tags to copy.
  it('keeps only paste for a selection', () => {
    expect(ids(ctx({ isMulti: true }))).toEqual(['paste-meta'])
  })

  // Without a configured format there is nothing to apply, so the row must not exist.
  it('adds the title format row only when a format is set and the handler exists', () => {
    const onApplyTitleFormat = vi.fn()
    expect(ids(ctx({ onApplyTitleFormat, titleFormat: ' ' }))).not.toContain('title-format')
    expect(ids(ctx({ titleFormat: '{title}' }))).not.toContain('title-format')
    expect(ids(ctx({ onApplyTitleFormat, titleFormat: '{title}' }))).toContain('title-format')
  })

  it('puts the one separator before the first row of the tag group', () => {
    const onApplyTitleFormat = vi.fn()
    const sep = (c: MoreItemsContext) =>
      moreItems(c)
        .filter((i) => i.separatorBefore)
        .map((i) => i.id)
    expect(sep(ctx())).toEqual(['copy-meta'])
    expect(sep(ctx({ onApplyTitleFormat, titleFormat: '{title}' }))).toEqual(['title-format'])
    expect(sep(ctx({ isMulti: true }))).toEqual([])
    expect(sep(ctx({ isMulti: true, onApplyTitleFormat, titleFormat: '{title}' }))).toEqual([
      'paste-meta',
    ])
  })

  it('offers restore only when the release left something to restore', () => {
    expect(ids(ctx())).not.toContain('restore-release')
    const items = moreItems(ctx({ restorableRelease: { year: '2020' } }))
    expect(items.at(-1)?.id).toBe('restore-release')
    expect(items.at(-1)?.separatorBefore).toBe(true)
  })

  it('names the copied track on paste and disables it while nothing is copied', () => {
    const empty = moreItems(ctx()).find((i) => i.id === 'paste-meta')
    expect(empty?.disabled).toBe(true)
    expect(empty?.label).toBe(tr('trackList.context.pasteMeta'))
    const held = moreItems(ctx({ copiedMetaTitle: 'Song' })).find((i) => i.id === 'paste-meta')
    expect(held?.disabled).toBe(false)
    expect(held?.label).toBe(tr('editor.pasteMetaFrom', { title: 'Song' }))
  })

  it('wires each row to its own callback and label', () => {
    const c = ctx()
    const byId = (id: string) => moreItems(c).find((i) => i.id === id)
    byId('reveal')?.onSelect()
    byId('copy-filename')?.onSelect()
    byId('copy-path')?.onSelect()
    byId('search-web')?.onSelect()
    byId('copy-meta')?.onSelect()
    byId('paste-meta')?.onSelect()
    for (const fn of [
      c.onReveal,
      c.onCopyFilename,
      c.onCopyPath,
      c.onSearchWeb,
      c.onCopyMeta,
      c.onPasteMeta,
    ]) {
      expect(fn).toHaveBeenCalledTimes(1)
    }
    expect(byId('reveal')?.label).toBe(tr('commands.reveal'))
    expect(byId('reveal')?.testid).toBe('reveal-file-btn')
    expect(byId('copy-meta')?.Icon).toBe(ClipboardCopy)
  })
})
