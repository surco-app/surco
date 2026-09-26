import { ClipboardItem, clipboard } from 'electron'

export async function writeClipboardImage(png: Buffer): Promise<void> {
  await clipboard.write([
    new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) }),
  ])
}

async function findImage(): Promise<{ item: ClipboardItem; type: string } | null> {
  for (const item of await clipboard.read()) {
    const type = item.types.find((t) => t.startsWith('image/'))
    if (type) return { item, type }
  }
  return null
}

export async function readClipboardImage(): Promise<Buffer | null> {
  const found = await findImage()
  if (!found) return null
  const blob = (await found.item.getType(found.type)) as Blob
  return Buffer.from(await blob.arrayBuffer())
}

export async function clipboardHasImage(): Promise<boolean> {
  return (await findImage()) !== null
}
