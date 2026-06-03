// The native menu bar is built in the main process, which can't reach the
// renderer's i18next instance. These strings mirror the renderer's language
// detection (navigator.language vs app.getLocale()) so the menu matches the
// rest of the UI. Items backed by an Electron `role` are localized by the OS
// automatically; only the app's custom labels live here.

export type MenuLang = 'es' | 'en'

interface MenuStrings {
  settings: string
  feedback: string
  file: string
  add: string
  reveal: string
  remove: string
  removeAll: string
  processCurrent: string
  processAll: string
}

const strings: Record<MenuLang, MenuStrings> = {
  es: {
    settings: 'Ajustes…',
    feedback: 'Enviar comentarios…',
    file: 'Archivo',
    add: 'Añadir pistas…',
    reveal: 'Mostrar en Finder',
    remove: 'Quitar de la lista',
    removeAll: 'Vaciar la lista',
    processCurrent: 'Procesar pista',
    processAll: 'Procesar todo',
  },
  en: {
    settings: 'Settings…',
    feedback: 'Send feedback…',
    file: 'File',
    add: 'Add tracks…',
    reveal: 'Reveal in Finder',
    remove: 'Remove from list',
    removeAll: 'Remove all',
    processCurrent: 'Process track',
    processAll: 'Process all',
  },
}

export function pickMenuLang(locale: string): MenuLang {
  return locale.toLowerCase().startsWith('es') ? 'es' : 'en'
}

export function createMenuT(locale: string): (key: keyof MenuStrings) => string {
  const lang = pickMenuLang(locale)
  return (key) => strings[lang][key]
}
