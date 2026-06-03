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
  view: string
  palette: string
  search: string
  play: string
  prev: string
  next: string
  help: string
  website: string
  checkUpdates: string
  upToDate: string
  updateError: string
  updatesDevOnly: string
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
    view: 'Ver',
    palette: 'Paleta de comandos',
    search: 'Buscar metadatos',
    play: 'Reproducir / pausar',
    prev: 'Pista anterior',
    next: 'Pista siguiente',
    help: 'Ayuda',
    website: 'Sitio web de Surco',
    checkUpdates: 'Buscar actualizaciones…',
    upToDate: 'Ya tienes la última versión de Surco.',
    updateError: 'No se pudo comprobar si hay actualizaciones.',
    updatesDevOnly: 'Las actualizaciones solo están disponibles en la app instalada.',
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
    view: 'View',
    palette: 'Command palette',
    search: 'Search metadata',
    play: 'Play / pause',
    prev: 'Previous track',
    next: 'Next track',
    help: 'Help',
    website: 'Surco website',
    checkUpdates: 'Check for Updates…',
    upToDate: "You're on the latest version of Surco.",
    updateError: 'Could not check for updates.',
    updatesDevOnly: 'Updates are only available in the installed app.',
  },
}

export function pickMenuLang(locale: string): MenuLang {
  return locale.toLowerCase().startsWith('es') ? 'es' : 'en'
}

export function createMenuT(locale: string): (key: keyof MenuStrings) => string {
  const lang = pickMenuLang(locale)
  return (key) => strings[lang][key]
}
