import { beforeEach, describe, expect, it, vi } from 'vitest'

const { FakeClipboardItem, systemClipboard } = vi.hoisted(() => {
  class FakeClipboardItem {
    readonly types: string[]
    constructor(private readonly data: Record<string, Blob | string>) {
      this.types = Object.keys(data)
    }
    async getType(type: string): Promise<Blob> {
      const value = this.data[type]
      return typeof value === 'string' ? new Blob([value], { type }) : value
    }
  }
  return { FakeClipboardItem, systemClipboard: { items: [] as FakeClipboardItem[] } }
})

vi.mock('electron', () => ({
  ClipboardItem: FakeClipboardItem,
  clipboard: {
    write: async (items: InstanceType<typeof FakeClipboardItem>[]) => {
      systemClipboard.items = items
    },
    read: async () => systemClipboard.items,
  },
}))

import { clipboardHasImage, readClipboardImage, writeClipboardImage } from './clipboardImage'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

beforeEach(() => {
  systemClipboard.items = []
})

describe('clipboard image', () => {
  it('pastes back exactly the artwork that was copied, so a cover moves between tracks intact', async () => {
    await writeClipboardImage(PNG)
    expect(await readClipboardImage()).toEqual(PNG)
  })

  it('offers the copied artwork as image/png so other apps recognise it as a picture', async () => {
    await writeClipboardImage(PNG)
    expect(systemClipboard.items.flatMap((item) => item.types)).toEqual(['image/png'])
  })

  it('finds the image when another app copies it alongside text, as browsers do', async () => {
    systemClipboard.items = [
      new FakeClipboardItem({
        'text/html': '<img src="cover.png">',
        'image/png': new Blob([PNG], { type: 'image/png' }),
      }),
    ]
    expect(await readClipboardImage()).toEqual(PNG)
    expect(await clipboardHasImage()).toBe(true)
  })

  it('pastes nothing when the clipboard holds only text, so the artwork is left alone', async () => {
    systemClipboard.items = [
      new FakeClipboardItem({ 'text/plain': 'Pray (W.I.P. In The Church Mix)' }),
    ]
    expect(await readClipboardImage()).toBeNull()
    expect(await clipboardHasImage()).toBe(false)
  })

  it('reports no image on an empty clipboard, so the paste affordance stays disabled', async () => {
    expect(await clipboardHasImage()).toBe(false)
  })
})
