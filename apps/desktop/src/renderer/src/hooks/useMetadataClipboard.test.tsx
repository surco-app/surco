// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { emptyMetadata } from '../../../shared/metadata'
import type { CopiedTags } from '../types'
import { useMetadataClipboard } from './useMetadataClipboard'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

function setup(copiedMeta: CopiedTags | null = null) {
  const patchTracks = vi.fn()
  const { result } = renderHook(() =>
    useMetadataClipboard({
      copiedMeta,
      setCopiedMeta: vi.fn(),
      tracksRef: { current: [] },
      selectedIds: ['a', 'b'],
      selected: null,
      filenameFormat: '{artist} - {title}',
      customFields: [],
      recordMetaUndo: vi.fn(),
      updateTracksMeta: vi.fn(),
      patchTracks,
      setNotice: vi.fn(),
    }),
  )
  return { ...result.current, patchTracks }
}

const copied: CopiedTags = {
  meta: { ...emptyMetadata(), title: 'Your Love' },
  coverUrl: 'https://i.discogs.com/cover.jpg',
}

// A cover the DJ stamps by hand is their choice, so a library copy found later must not put
// its own picture over it.
describe('useMetadataClipboard and the DJ cover choice', () => {
  it('marks a cover stamped on a whole selection as picked by hand', () => {
    const { onApplyCoverAll, patchTracks } = setup()
    onApplyCoverAll('blob:cover', '/img/c.png')
    expect(patchTracks).toHaveBeenCalledWith(['a', 'b'], {
      coverUrl: 'blob:cover',
      coverPath: '/img/c.png',
      coverPicked: true,
    })
  })

  it('marks a pasted cover as picked by hand', () => {
    const { onPasteMeta, onPasteMetaAll, patchTracks } = setup(copied)
    onPasteMeta({ id: 'a' } as never)
    onPasteMetaAll(['a', 'b'])
    expect(patchTracks).toHaveBeenNthCalledWith(
      1,
      ['a'],
      expect.objectContaining({ coverPicked: true }),
    )
    expect(patchTracks).toHaveBeenNthCalledWith(
      2,
      ['a', 'b'],
      expect.objectContaining({ coverPicked: true }),
    )
  })
})
