import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { nativeImage } from 'electron'

const SIZES: [name: string, max: number][] = [
  ['artwork.jpg', 800],
  ['artwork_m.jpg', 240],
  ['artwork_s.jpg', 80],
]

const JPEG_QUALITY = 90

export interface StagedArtwork {
  imagePath: string
  folder: string
}

export function rekordboxShareDir(collectionPath: string): string {
  return join(dirname(collectionPath), 'share')
}

export function renderArtwork(cover: Buffer): Map<string, Buffer> | null {
  try {
    const source = nativeImage.createFromBuffer(cover)
    if (source.isEmpty()) return null
    const { width, height } = source.getSize()
    const rendered = new Map<string, Buffer>()
    for (const [name, max] of SIZES) {
      const scale = Math.min(1, max / Math.max(width, height))
      const image =
        scale < 1
          ? source.resize({
              width: Math.round(width * scale),
              height: Math.round(height * scale),
              quality: 'best',
            })
          : source
      rendered.set(name, image.toJPEG(JPEG_QUALITY))
    }
    return rendered
  } catch {
    return null
  }
}

function insideShare(share: string, candidate: string): boolean {
  const rel = relative(resolve(share), candidate)
  return rel !== '' && !rel.startsWith('..') && !rel.startsWith(sep)
}

function sameAsCurrent(share: string, currentImagePath: string | null, large: Buffer): boolean {
  if (!currentImagePath) return false
  const current = resolve(share, `.${currentImagePath}`)
  if (!insideShare(share, current) || !existsSync(current)) return false
  return readFileSync(current).equals(large)
}

export function stageArtwork(
  share: string,
  currentImagePath: string | null,
  rendered: Map<string, Buffer>,
  newUuid: () => string = randomUUID,
): StagedArtwork | null {
  const large = rendered.get('artwork.jpg')
  if (!large || sameAsCurrent(share, currentImagePath, large)) return null
  const uuid = newUuid()
  const relativeFolder = `/PIONEER/Artwork/${uuid.slice(0, 3)}/${uuid.slice(3)}`
  const folder = join(share, relativeFolder)
  mkdirSync(folder, { recursive: true })
  for (const [name, bytes] of rendered) writeFileSync(join(folder, name), bytes)
  return { imagePath: `${relativeFolder}/artwork.jpg`, folder }
}

export function discardArtwork(staged: StagedArtwork): void {
  rmSync(staged.folder, { recursive: true, force: true })
}
