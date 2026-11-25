import type { LucideIcon } from 'lucide-react'
import type { TFunction } from 'i18next'
import type { MetaTextKey } from '../../../shared/types'
import type { MetaMenuItem } from '../components/MetaMoreMenu'

export type MoreItemsContext = {
  isMulti: boolean
  tr: TFunction
  revealKey: string
  icons: {
    Folder: LucideIcon
    Copy: LucideIcon
    Link: LucideIcon
    Globe: LucideIcon
    Braces: LucideIcon
    ClipboardCopy: LucideIcon
    ClipboardPaste: LucideIcon
    Undo2: LucideIcon
  }
  onReveal: () => void
  onCopyFilename: () => void
  onCopyPath: () => void
  onSearchWeb: () => void
  onApplyTitleFormat: (() => void) | undefined
  titleFormat: string
  onCopyMeta: () => void
  onPasteMeta: () => void
  copiedMetaTitle: string | null
  restorableRelease: Partial<Record<MetaTextKey, string>>
  restoreRelease: () => void
}

// The glyphs that used to run along the header, now one menu: the file's own actions
// first (reveal, copy the name, search it), then what works on the tags. "Rewrite titles"
// only exists when a title format is configured, since without one there is nothing to apply.
export function moreItems({
  isMulti,
  tr,
  revealKey,
  icons,
  onReveal,
  onCopyFilename,
  onCopyPath,
  onSearchWeb,
  onApplyTitleFormat,
  titleFormat,
  onCopyMeta,
  onPasteMeta,
  copiedMetaTitle,
  restorableRelease,
  restoreRelease,
}: MoreItemsContext): MetaMenuItem[] {
  const pasteMetaLabel = copiedMetaTitle
    ? tr('editor.pasteMetaFrom', { title: copiedMetaTitle })
    : tr('trackList.context.pasteMeta')
  return [
    ...(isMulti
      ? []
      : [
          {
            id: 'reveal',
            testid: 'reveal-file-btn',
            label: tr(revealKey),
            Icon: icons.Folder,
            onSelect: onReveal,
          },
          {
            id: 'copy-filename',
            testid: 'copy-filename-btn',
            label: tr('editor.copyFilename'),
            Icon: icons.Copy,
            onSelect: onCopyFilename,
          },
          {
            id: 'copy-path',
            testid: 'copy-path-btn',
            label: tr('trackList.context.copyPath'),
            Icon: icons.Link,
            onSelect: onCopyPath,
          },
          {
            id: 'search-web',
            testid: 'search-web-btn',
            label: tr('editor.searchWeb'),
            Icon: icons.Globe,
            onSelect: onSearchWeb,
          },
        ]),
    ...(onApplyTitleFormat && titleFormat.trim() !== ''
      ? [
          {
            id: 'title-format',
            testid: 'apply-title-format-btn',
            label: tr('editor.applyTitleFormat'),
            Icon: icons.Braces,
            onSelect: onApplyTitleFormat,
            separatorBefore: !isMulti,
          },
        ]
      : []),
    ...(isMulti
      ? []
      : [
          {
            id: 'copy-meta',
            testid: 'copy-meta-btn',
            label: tr('trackList.context.copyMeta'),
            Icon: icons.ClipboardCopy,
            onSelect: onCopyMeta,
            separatorBefore: !(onApplyTitleFormat && titleFormat.trim() !== ''),
          },
        ]),
    {
      id: 'paste-meta',
      testid: 'paste-meta-btn',
      label: pasteMetaLabel,
      Icon: icons.ClipboardPaste,
      onSelect: onPasteMeta,
      disabled: copiedMetaTitle === null,
      separatorBefore: isMulti && !!onApplyTitleFormat && titleFormat.trim() !== '',
    },
    ...(Object.keys(restorableRelease).length > 0
      ? [
          {
            id: 'restore-release',
            testid: 'restore-release-btn',
            label: tr('editor.restoreRelease'),
            Icon: icons.Undo2,
            onSelect: restoreRelease,
            separatorBefore: true,
          },
        ]
      : []),
  ]
}
