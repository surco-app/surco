import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

const desktop = resolve(__dirname, '../..')
const builderConfig = (): string => readFileSync(resolve(desktop, 'electron-builder.yml'), 'utf8')
const manifest = (): string => readFileSync(resolve(desktop, 'build/appx-manifest.xml'), 'utf8')

it('declares the identity Partner Center reserved, or the Store rejects every upload', () => {
  const config = builderConfig()

  expect(config).toContain('identityName: VicentGozalbes.Surco')
  expect(config).toContain('publisher: CN=D13B979E-AC81-4811-B7E0-309749169C20')
  expect(config).toContain('publisherDisplayName: Vicent Gozalbes')
  expect(config).toContain('customManifestPath: appx-manifest.xml')
})

it('keeps AppData writes unredirected, or a Store-only user loses their Originals on uninstall', () => {
  const xml = manifest()

  expect(xml).toContain(
    '<desktop6:FileSystemWriteVirtualization>disabled</desktop6:FileSystemWriteVirtualization>',
  )
  expect(xml).toContain('Name="unvirtualizedResources"')
  expect(xml).toContain('Name="runFullTrust"')
  expect(xml).toContain('MinVersion="10.0.18362.0"')
})

it('packs with Windows Kits new enough to read desktop6, or makeappx rejects the manifest', () => {
  expect(builderConfig()).toContain('winCodeSign: "1.1.0"')
})

it('ships Surco tiles, or the Store shows Electron sample logos', () => {
  for (const tile of [
    'StoreLogo.png',
    'Square44x44Logo.png',
    'Square150x150Logo.png',
    'Wide310x150Logo.png',
  ]) {
    expect(existsSync(resolve(desktop, 'build/appx', tile)), tile).toBe(true)
  }
})
