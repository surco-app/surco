import { describe, expect, it } from 'vitest'
import { createMenuT, pickMenuLang, resolveMenuLocale } from './i18n'
import ja from './locales/ja.json'

describe('pickMenuLang', () => {
  // The native menu lives in the main process, which has no access to the
  // renderer's navigator.language. It must reach the same es/en decision from
  // the OS locale so the menu bar matches the rest of the UI instead of always
  // showing the hardcoded Spanish it used to.
  it('chooses Spanish for any es-* locale', () => {
    expect(pickMenuLang('es-ES')).toBe('es')
    expect(pickMenuLang('es')).toBe('es')
  })

  it('maps every shipped language, collapsing regional variants', () => {
    expect(pickMenuLang('de-AT')).toBe('de')
    expect(pickMenuLang('fr-FR')).toBe('fr')
    expect(pickMenuLang('pt-PT')).toBe('pt-BR')
    expect(pickMenuLang('pt-BR')).toBe('pt-BR')
    expect(pickMenuLang('ja')).toBe('ja')
    expect(pickMenuLang('ja-JP')).toBe('ja')
  })

  it('falls back to English for anything not shipped', () => {
    expect(pickMenuLang('en-US')).toBe('en')
    expect(pickMenuLang('ko-KR')).toBe('en')
    expect(pickMenuLang('')).toBe('en')
  })
})

describe('createMenuT', () => {
  it('asks to close Engine DJ for cues without promising a conversion that is not running', () => {
    for (const lang of ['es', 'en', 'de', 'fr', 'pt-BR']) {
      const t = createMenuT(lang)
      expect(t('engineQuitDetailCues')).not.toBe(t('engineQuitDetail'))
    }
    expect(createMenuT('es')('engineQuitDetailCues')).toBe(
      'Surco necesita cerrarlo para guardar las cues en su biblioteca. Engine DJ se cerrará de forma segura y puedes volver a abrirlo enseguida.',
    )
  })

  it('asks to close Traktor for cues without promising a conversion that is not running', () => {
    for (const lang of ['es', 'en', 'de', 'fr', 'pt-BR']) {
      const t = createMenuT(lang)
      expect(t('traktorQuitDetailCues')).not.toBe(t('traktorQuitDetail'))
    }
    expect(createMenuT('es')('traktorQuitDetailCues')).toBe(
      'Surco necesita cerrarlo para guardar las cues en collection.nml. Traktor se cerrará de forma segura y puedes volver a abrirlo enseguida.',
    )
  })

  it('asks to close Traktor for a playlist change with its own words', () => {
    for (const lang of ['es', 'en', 'de', 'fr', 'pt-BR']) {
      const t = createMenuT(lang)
      expect(t('traktorQuitDetailPlaylists')).not.toBe(t('traktorQuitDetail'))
    }
    expect(createMenuT('es')('traktorQuitDetailPlaylists')).toBe(
      'Surco necesita cerrarlo para guardar el cambio en tus playlists. Traktor se cerrará de forma segura y puedes volver a abrirlo enseguida.',
    )
  })

  it('translates a key for the resolved locale', () => {
    expect(createMenuT('es-ES')('settings')).toBe('Ajustes…')
    expect(createMenuT('en-US')('settings')).toBe('Settings…')
  })

  it('uses English when the locale is unsupported', () => {
    expect(createMenuT('ko-KR')('feedback')).toBe('Send feedback…')
  })

  it('translates for the newly shipped languages', () => {
    expect(createMenuT('de-DE')('settings')).toBe('Einstellungen…')
    expect(createMenuT('fr-FR')('settings')).toBe('Réglages…')
    expect(createMenuT('pt-BR')('file')).toBe('Arquivo')
    expect(createMenuT('ja-JP')('settings')).toBe(createMenuT('ja')('settings'))
  })

  it('covers the menus added beyond the original two items', () => {
    expect(createMenuT('es')('checkUpdates')).toBe('Buscar actualizaciones…')
    expect(createMenuT('en')('checkUpdates')).toBe('Check for Updates…')
    expect(createMenuT('es')('file')).toBe('Archivo')
    expect(createMenuT('en')('help')).toBe('Help')
    expect(createMenuT('es')('faq')).toBe('Preguntas frecuentes')
    expect(createMenuT('en')('faq')).toBe('Frequently Asked Questions')
    expect(createMenuT('es')('guide')).toBe('Guía de uso')
    expect(createMenuT('en')('guide')).toBe('User guide')
  })

  it('asks to close each program for a restore and to keep it closed until Surco finishes', () => {
    for (const lang of ['es', 'en', 'de', 'fr', 'pt-BR', 'ja']) {
      const t = createMenuT(lang)
      expect(t('rekordboxQuitDetailRestore')).toBeTruthy()
      expect(t('rekordboxQuitDetailRestore')).not.toBe(t('rekordboxQuitDetailPlaylists'))
      expect(t('traktorQuitDetailRestore')).toBeTruthy()
      expect(t('traktorQuitDetailRestore')).not.toBe(t('traktorQuitDetailCues'))
      expect(t('engineQuitDetailRestore')).toBeTruthy()
      expect(t('engineQuitDetailRestore')).not.toBe(t('engineQuitDetailCues'))
    }
    expect(createMenuT('es')('rekordboxQuitDetailRestore')).toBe(
      'Surco necesita cerrarlo para restaurar tu colección. rekordbox se cerrará de forma segura; no lo vuelvas a abrir hasta que Surco termine de restaurar.',
    )
  })
})

describe('resolveMenuLocale', () => {
  // A user who pins a language in Settings expects the native menu and dialogs to
  // follow it too — before this, every native surface read app.getLocale() (the
  // OS language) directly, so a macOS-in-English user who set Surco to Spanish saw
  // a Spanish UI with an English menu bar.
  it('uses the pinned language regardless of the OS locale', () => {
    expect(resolveMenuLocale('es', 'en-US')).toBe('es')
    expect(resolveMenuLocale('en', 'es-ES')).toBe('en')
    expect(resolveMenuLocale('de', 'fr-FR')).toBe('de')
    expect(resolveMenuLocale('pt-BR', 'en-US')).toBe('pt-BR')
    expect(resolveMenuLocale('ja', 'en-US')).toBe('ja')
  })

  // 'system' (the default) is the one case that should still follow the OS —
  // matching resolveLocale's contract in the renderer (i18n/locale.ts).
  it('follows the OS locale when the preference is "system"', () => {
    expect(resolveMenuLocale('system', 'de-DE')).toBe('de-DE')
    expect(resolveMenuLocale('system', 'ja-JP')).toBe('ja-JP')
  })
})

describe('the track-list search label', () => {
  // The View menu, the palette and the shortcut list all run the same command, which puts
  // the cursor in the track-list filter. Calling it a Discogs or metadata search sent DJs
  // looking for results that never came.
  it('names the track list in the menu and the palette alike', async () => {
    for (const lang of ['es', 'en', 'de', 'fr', 'pt-BR', 'ja']) {
      const palette = (await import(`../renderer/src/i18n/locales/${lang}.json`)).default
      expect(palette.commands.search).not.toMatch(/Discogs/)
      expect(createMenuT(lang)('search')).toBe(palette.commands.search)
    }
  })
})

// The native menus and dialogs speak like the rest of the French app: tu, never vous.
describe('French native strings', () => {
  it('address the user as tu', () => {
    const t = createMenuT('fr')
    const keys = Object.keys(ja) as (keyof typeof ja)[]
    expect(keys.map(t).filter((text) => /\b(vous|votre|vos)\b/i.test(text))).toEqual([])
  })
})
