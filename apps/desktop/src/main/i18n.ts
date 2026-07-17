// The native menu bar is built in the main process, which can't reach the
// renderer's i18next instance. These strings mirror the renderer's language
// detection (navigator.language vs app.getLocale()) so the menu matches the
// rest of the UI. Items backed by an Electron `role` are localized by the OS
// automatically; only the app's custom labels live here.

export type MenuLang = 'es' | 'en' | 'de' | 'fr' | 'pt-BR'

interface MenuStrings {
  settings: string
  feedback: string
  file: string
  add: string
  reveal: string
  rename: string
  findReplace: string
  addAppleMusic: string
  remove: string
  removeAll: string
  processCurrent: string
  processAll: string
  view: string
  palette: string
  activity: string
  search: string
  play: string
  prev: string
  next: string
  help: string
  faq: string
  guide: string
  website: string
  // The About panel's credits block: authorship and the people whose ideas and
  // feedback shape Surco.
  aboutCredits: string
  checkUpdates: string
  upToDate: string
  updateError: string
  updatesDevOnly: string
  conflictExists: string
  conflictOverwrite: string
  conflictKeepBoth: string
  conflictSkip: string
  conflictApplyRemaining: string
  appleMusicGone: string
  engineQuitMessage: string
  engineQuitDetail: string
  engineQuitConfirm: string
  engineQuitCancel: string
  engineOpenError: string
}

const strings: Record<MenuLang, MenuStrings> = {
  es: {
    settings: 'Ajustes…',
    feedback: 'Enviar comentarios…',
    file: 'Archivo',
    add: 'Añadir pistas…',
    reveal: 'Mostrar en Finder',
    rename: 'Generar nombre del archivo…',
    findReplace: 'Buscar y reemplazar…',
    addAppleMusic: 'Añadir a Apple Music',
    remove: 'Quitar de la lista',
    removeAll: 'Vaciar la lista',
    processCurrent: 'Procesar pista',
    processAll: 'Procesar todo',
    view: 'Ver',
    palette: 'Paleta de comandos',
    activity: 'Actividad',
    search: 'Buscar metadatos',
    play: 'Reproducir / pausar',
    prev: 'Pista anterior',
    next: 'Pista siguiente',
    help: 'Ayuda',
    faq: 'Preguntas frecuentes',
    guide: 'Guía de uso',
    website: 'Sitio web de Surco',
    aboutCredits:
      'Hecha con cariño por Vicent Gozalbes\nvigosan@gmail.com\n\nGracias a @djotas y a quienes\naportan ideas y feedback.\n\ngetsurco.app',
    checkUpdates: 'Buscar actualizaciones…',
    upToDate: 'Ya tienes la última versión de Surco.',
    updateError: 'No se pudo comprobar si hay actualizaciones.',
    updatesDevOnly: 'Las actualizaciones solo están disponibles en la app instalada.',
    conflictExists: 'Ya existe un archivo con ese nombre en la carpeta de destino.',
    conflictOverwrite: 'Sobrescribir',
    conflictKeepBoth: 'Conservar ambos',
    conflictSkip: 'Saltar',
    conflictApplyRemaining: 'Aplicar al resto de conflictos de esta conversión',
    appleMusicGone: 'La pista ya no está en tu biblioteca de Apple Music.',
    engineQuitMessage: 'Engine DJ está abierto',
    engineQuitDetail:
      'Surco necesita cerrarlo para escribir en su biblioteca. Engine DJ se cerrará de forma segura; puedes volver a abrirlo cuando termine la conversión.',
    engineQuitConfirm: 'Cerrar Engine DJ',
    engineQuitCancel: 'Cancelar',
    engineOpenError: 'Cierra Engine DJ antes de convertir: tiene la biblioteca abierta.',
  },
  en: {
    settings: 'Settings…',
    feedback: 'Send feedback…',
    file: 'File',
    add: 'Add tracks…',
    reveal: 'Reveal in Finder',
    rename: 'Build file name…',
    findReplace: 'Find & Replace…',
    addAppleMusic: 'Add to Apple Music',
    remove: 'Remove from list',
    removeAll: 'Remove all',
    processCurrent: 'Process track',
    processAll: 'Process all',
    view: 'View',
    palette: 'Command palette',
    activity: 'Activity',
    search: 'Search metadata',
    play: 'Play / pause',
    prev: 'Previous track',
    next: 'Next track',
    help: 'Help',
    faq: 'Frequently Asked Questions',
    guide: 'User guide',
    website: 'Surco website',
    aboutCredits:
      'Made with care by Vicent Gozalbes\nvigosan@gmail.com\n\nThanks to @djotas and everyone\nwho shares ideas and feedback.\n\ngetsurco.app',
    checkUpdates: 'Check for Updates…',
    upToDate: "You're on the latest version of Surco.",
    updateError: 'Could not check for updates.',
    updatesDevOnly: 'Updates are only available in the installed app.',
    conflictExists: 'A file with this name already exists in the destination folder.',
    conflictOverwrite: 'Overwrite',
    conflictKeepBoth: 'Keep both',
    conflictSkip: 'Skip',
    conflictApplyRemaining: 'Apply to the rest of this conversion’s conflicts',
    appleMusicGone: 'The track is no longer in your Apple Music library.',
    engineQuitMessage: 'Engine DJ is open',
    engineQuitDetail:
      'Surco needs to close it to write into its library. Engine DJ will quit safely; reopen it once the conversion finishes.',
    engineQuitConfirm: 'Close Engine DJ',
    engineQuitCancel: 'Cancel',
    engineOpenError: 'Close Engine DJ before converting: it has the library open.',
  },
  de: {
    settings: 'Einstellungen…',
    feedback: 'Feedback senden…',
    file: 'Datei',
    add: 'Tracks hinzufügen…',
    reveal: 'Im Finder zeigen',
    rename: 'Dateinamen erstellen…',
    findReplace: 'Suchen & Ersetzen…',
    addAppleMusic: 'Zu Apple Music hinzufügen',
    remove: 'Aus der Liste entfernen',
    removeAll: 'Liste leeren',
    processCurrent: 'Track verarbeiten',
    processAll: 'Alle verarbeiten',
    view: 'Ansicht',
    palette: 'Befehlspalette',
    activity: 'Aktivität',
    search: 'Metadaten suchen',
    play: 'Abspielen / Pause',
    prev: 'Vorheriger Track',
    next: 'Nächster Track',
    help: 'Hilfe',
    faq: 'Häufige Fragen',
    guide: 'Benutzerhandbuch',
    website: 'Surco-Website',
    aboutCredits:
      'Mit Sorgfalt gemacht von Vicent Gozalbes\nvigosan@gmail.com\n\nDanke an @djotas und alle, die Ideen\nund Feedback beisteuern.\n\ngetsurco.app',
    checkUpdates: 'Nach Updates suchen…',
    upToDate: 'Du hast bereits die neueste Version von Surco.',
    updateError: 'Nach Updates konnte nicht gesucht werden.',
    updatesDevOnly: 'Updates sind nur in der installierten App verfügbar.',
    conflictExists: 'Im Zielordner existiert bereits eine Datei mit diesem Namen.',
    conflictOverwrite: 'Überschreiben',
    conflictKeepBoth: 'Beide behalten',
    conflictSkip: 'Überspringen',
    conflictApplyRemaining: 'Auf die übrigen Konflikte dieser Konvertierung anwenden',
    appleMusicGone: 'Der Track ist nicht mehr in deiner Apple Music-Bibliothek.',
    engineQuitMessage: 'Engine DJ ist geöffnet',
    engineQuitDetail:
      'Surco muss es schließen, um in seine Bibliothek zu schreiben. Engine DJ wird sicher beendet; du kannst es nach der Konvertierung wieder öffnen.',
    engineQuitConfirm: 'Engine DJ schließen',
    engineQuitCancel: 'Abbrechen',
    engineOpenError: 'Schließ Engine DJ vor dem Konvertieren: Es hat die Bibliothek geöffnet.',
  },
  fr: {
    settings: 'Réglages…',
    feedback: 'Envoyer un retour…',
    file: 'Fichier',
    add: 'Ajouter des morceaux…',
    reveal: 'Afficher dans le Finder',
    rename: 'Composer le nom du fichier…',
    findReplace: 'Rechercher et remplacer…',
    addAppleMusic: 'Ajouter à Apple Music',
    remove: 'Retirer de la liste',
    removeAll: 'Vider la liste',
    processCurrent: 'Traiter le morceau',
    processAll: 'Tout traiter',
    view: 'Présentation',
    palette: 'Palette de commandes',
    activity: 'Activité',
    search: 'Rechercher les métadonnées',
    play: 'Lecture / pause',
    prev: 'Morceau précédent',
    next: 'Morceau suivant',
    help: 'Aide',
    faq: 'Questions fréquentes',
    guide: "Guide d'utilisation",
    website: 'Site web de Surco',
    aboutCredits:
      'Fait avec soin par Vicent Gozalbes\nvigosan@gmail.com\n\nMerci à @djotas et à toutes les personnes\nqui partagent idées et retours.\n\ngetsurco.app',
    checkUpdates: 'Rechercher les mises à jour…',
    upToDate: 'Tu as déjà la dernière version de Surco.',
    updateError: 'Impossible de vérifier les mises à jour.',
    updatesDevOnly: "Les mises à jour ne sont disponibles que dans l'app installée.",
    conflictExists: 'Un fichier du même nom existe déjà dans le dossier de destination.',
    conflictOverwrite: 'Écraser',
    conflictKeepBoth: 'Conserver les deux',
    conflictSkip: 'Ignorer',
    conflictApplyRemaining: 'Appliquer au reste des conflits de cette conversion',
    appleMusicGone: "Le morceau n'est plus dans ta bibliothèque Apple Music.",
    engineQuitMessage: 'Engine DJ est ouvert',
    engineQuitDetail:
      'Surco doit le fermer pour écrire dans sa bibliothèque. Engine DJ sera fermé proprement ; tu pourras le rouvrir à la fin de la conversion.',
    engineQuitConfirm: 'Fermer Engine DJ',
    engineQuitCancel: 'Annuler',
    engineOpenError: 'Ferme Engine DJ avant de convertir : sa bibliothèque est ouverte.',
  },
  'pt-BR': {
    settings: 'Ajustes…',
    feedback: 'Enviar feedback…',
    file: 'Arquivo',
    add: 'Adicionar faixas…',
    reveal: 'Mostrar no Finder',
    rename: 'Gerar nome do arquivo…',
    findReplace: 'Localizar e substituir…',
    addAppleMusic: 'Adicionar ao Apple Music',
    remove: 'Remover da lista',
    removeAll: 'Limpar a lista',
    processCurrent: 'Processar faixa',
    processAll: 'Processar tudo',
    view: 'Visualizar',
    palette: 'Paleta de comandos',
    activity: 'Atividade',
    search: 'Buscar metadados',
    play: 'Reproduzir / pausar',
    prev: 'Faixa anterior',
    next: 'Próxima faixa',
    help: 'Ajuda',
    faq: 'Perguntas frequentes',
    guide: 'Guia de uso',
    website: 'Site do Surco',
    aboutCredits:
      'Feito com carinho por Vicent Gozalbes\nvigosan@gmail.com\n\nObrigado a @djotas e a todos que\ncompartilham ideias e feedback.\n\ngetsurco.app',
    checkUpdates: 'Buscar atualizações…',
    upToDate: 'Você já tem a versão mais recente do Surco.',
    updateError: 'Não foi possível verificar se há atualizações.',
    updatesDevOnly: 'As atualizações só estão disponíveis no app instalado.',
    conflictExists: 'Já existe um arquivo com esse nome na pasta de destino.',
    conflictOverwrite: 'Sobrescrever',
    conflictKeepBoth: 'Manter ambos',
    conflictSkip: 'Pular',
    conflictApplyRemaining: 'Aplicar aos demais conflitos desta conversão',
    appleMusicGone: 'A faixa não está mais na sua biblioteca do Apple Music.',
    engineQuitMessage: 'O Engine DJ está aberto',
    engineQuitDetail:
      'O Surco precisa fechá-lo para escrever na biblioteca dele. O Engine DJ será fechado com segurança; você pode reabri-lo quando a conversão terminar.',
    engineQuitConfirm: 'Fechar o Engine DJ',
    engineQuitCancel: 'Cancelar',
    engineOpenError: 'Feche o Engine DJ antes de converter: ele está com a biblioteca aberta.',
  },
}

// Mirrors the renderer's baseLocale mapping (i18n/locale.ts): regional variants
// collapse onto a shipped language, Portuguese always lands on pt-BR, and anything
// not shipped falls back to English.
const MENU_PREFIXES: [string, MenuLang][] = [
  ['es', 'es'],
  ['de', 'de'],
  ['fr', 'fr'],
  ['pt', 'pt-BR'],
]
export function pickMenuLang(locale: string): MenuLang {
  const tag = locale.toLowerCase()
  for (const [prefix, lang] of MENU_PREFIXES) if (tag.startsWith(prefix)) return lang
  return 'en'
}

export function createMenuT(locale: string): (key: keyof MenuStrings) => string {
  const lang = pickMenuLang(locale)
  return (key) => strings[lang][key]
}

// The effective locale for the native menu and dialogs: a pinned language (Settings)
// wins over the OS, matching resolveLocale's contract for the renderer UI
// (i18n/locale.ts) — a user who sets Surco to Spanish expects the menu bar and
// native dialogs (conflict prompts, Engine DJ quit, updater messages) to follow,
// not stay on whatever language macOS itself is running in.
export function resolveMenuLocale(pref: 'system' | MenuLang, systemLocale: string): string {
  return pref === 'system' ? systemLocale : pref
}
