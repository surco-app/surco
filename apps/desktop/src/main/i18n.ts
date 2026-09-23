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
  info: string
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
  backups: string
  stats: string
  tracks: string
  analyzeQuality: string
  selectAllTracks: string
  fillAll: string
  trashSelected: string
  search: string
  play: string
  prev: string
  next: string
  help: string
  faq: string
  guide: string
  setupAssistant: string
  website: string
  // The About panel's credits block: authorship and the people whose ideas and
  // feedback shape Surco.
  aboutCredits: string
  checkUpdates: string
  upToDate: string
  updatesDevOnly: string
  conflictExists: string
  conflictReserved: string
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
  traktorQuitMessage: string
  traktorQuitDetail: string
  traktorQuitConfirm: string
  traktorQuitCancel: string
  traktorSyncBlocked: string
  rekordboxQuitMessage: string
  rekordboxQuitDetail: string
  rekordboxQuitConfirm: string
  rekordboxQuitCancel: string
  rekordboxSyncBlocked: string
  quitBusyMessage: string
  quitBusyDetail: string
  quitBusyConfirm: string
  quitBusyCancel: string
  dialogConfigDir: string
  dialogPickTracks: string
  dialogOutputDir: string
  dialogEngineLibrary: string
  dialogTraktorCollection: string
  dialogRekordboxCollection: string
  dialogExportCover: string
  dialogExportRekordbox: string
  dialogExportTraktor: string
  dialogExportSerato: string
  dialogSaveQualityReport: string
  dialogSaveStats: string
  dialogStatsFileName: string
  dialogExportM3u: string
  dialogExportSettings: string
  dialogImportSettings: string
}

const strings: Record<MenuLang, MenuStrings> = {
  es: {
    settings: 'Ajustes…',
    feedback: 'Enviar comentarios…',
    file: 'Archivo',
    add: 'Añadir pistas…',
    info: 'Información',
    reveal: 'Mostrar en Finder',
    rename: 'Generar nombre del archivo…',
    findReplace: 'Buscar y reemplazar…',
    addAppleMusic: 'Añadir a Apple Music',
    remove: 'Quitar de la lista',
    removeAll: 'Vaciar la lista',
    processCurrent: 'Convertir pista',
    processAll: 'Convertir todo',
    view: 'Ver',
    palette: 'Paleta de comandos',
    activity: 'Actividad',
    backups: 'Copias de seguridad',
    stats: 'Estadísticas',
    tracks: 'Pistas',
    analyzeQuality: 'Analizar calidad',
    selectAllTracks: 'Seleccionar todas las pistas',
    fillAll: 'Rellenar todo desde el nombre…',
    trashSelected: 'Mover la selección a la papelera…',
    search: 'Buscar en la lista de pistas',
    play: 'Reproducir / pausar',
    prev: 'Pista anterior',
    next: 'Pista siguiente',
    help: 'Ayuda',
    faq: 'Preguntas frecuentes',
    guide: 'Guía de uso',
    setupAssistant: 'Asistente de configuración…',
    website: 'Sitio web de Surco',
    aboutCredits:
      'Hecha con cariño por Vicent Gozalbes\nvigosan@gmail.com\n\nGracias a @djotas y a quienes\naportan ideas y feedback.\n\ngetsurco.app',
    checkUpdates: 'Buscar actualizaciones…',
    upToDate: 'Ya tienes la última versión de Surco.',
    updatesDevOnly: 'Las actualizaciones solo están disponibles en la app instalada.',
    conflictExists: 'Ya existe un archivo con ese nombre en la carpeta de destino.',
    conflictReserved:
      'Otra pista de esta conversión se va a guardar con este mismo nombre y aún no está escrita. Con Sobrescribir o Conservar ambos, esta se guarda con un número añadido al nombre.',
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
    traktorQuitMessage: 'Traktor está abierto',
    traktorQuitDetail:
      'Surco necesita cerrarlo para escribir en collection.nml. Traktor se cerrará de forma segura; puedes volver a abrirlo cuando termine la conversión.',
    traktorQuitConfirm: 'Cerrar Traktor',
    traktorQuitCancel: 'Cancelar',
    traktorSyncBlocked: 'La colección de Traktor no se ha actualizado: Traktor sigue abierto.',
    rekordboxQuitMessage: 'rekordbox está abierto',
    rekordboxQuitDetail:
      'Surco necesita cerrarlo para actualizar tu colección y que apunte al archivo nuevo. rekordbox se cerrará de forma segura; puedes volver a abrirlo cuando termine la conversión.',
    rekordboxQuitConfirm: 'Cerrar rekordbox',
    rekordboxQuitCancel: 'Cancelar',
    rekordboxSyncBlocked:
      'La colección de rekordbox no se ha actualizado: rekordbox sigue abierto. Ciérralo y vuelve a convertir para que apunte al archivo nuevo.',
    quitBusyMessage: 'Hay conversiones en curso',
    quitBusyDetail:
      'Si sales ahora se detendrán {n} conversiones y las pistas que faltan se quedarán sin convertir.',
    quitBusyConfirm: 'Salir igualmente',
    quitBusyCancel: 'Seguir convirtiendo',
    dialogConfigDir: 'Carpeta de configuración',
    dialogPickTracks: 'Selecciona pistas',
    dialogOutputDir: 'Carpeta de salida',
    dialogEngineLibrary: 'Biblioteca de Engine DJ',
    dialogTraktorCollection: 'Colección de Traktor',
    dialogRekordboxCollection: 'Colección de rekordbox',
    dialogExportCover: 'Exporta la carátula',
    dialogExportRekordbox: 'Exporta a rekordbox',
    dialogExportTraktor: 'Exporta a Traktor',
    dialogExportSerato: 'Exporta a Serato',
    dialogSaveQualityReport: 'Guarda el informe de calidad',
    dialogSaveStats: 'Guarda tus estadísticas',
    dialogStatsFileName: 'Mis estadísticas de Surco.png',
    dialogExportM3u: 'Exporta a M3U8',
    dialogExportSettings: 'Exporta la configuración',
    dialogImportSettings: 'Importa la configuración',
  },
  en: {
    settings: 'Settings…',
    feedback: 'Send feedback…',
    file: 'File',
    add: 'Add tracks…',
    info: 'Info',
    reveal: 'Reveal in Finder',
    rename: 'Build file name…',
    findReplace: 'Find & Replace…',
    addAppleMusic: 'Add to Apple Music',
    remove: 'Remove from list',
    removeAll: 'Remove all',
    processCurrent: 'Convert track',
    processAll: 'Convert all',
    view: 'View',
    palette: 'Command palette',
    activity: 'Activity',
    backups: 'Backups',
    stats: 'Stats',
    tracks: 'Tracks',
    analyzeQuality: 'Analyze quality',
    selectAllTracks: 'Select all tracks',
    fillAll: 'Fill all tags from file name…',
    trashSelected: 'Move selection to Trash…',
    search: 'Search the track list',
    play: 'Play / pause',
    prev: 'Previous track',
    next: 'Next track',
    help: 'Help',
    faq: 'Frequently Asked Questions',
    guide: 'User guide',
    setupAssistant: 'Setup assistant…',
    website: 'Surco website',
    aboutCredits:
      'Made with care by Vicent Gozalbes\nvigosan@gmail.com\n\nThanks to @djotas and everyone\nwho shares ideas and feedback.\n\ngetsurco.app',
    checkUpdates: 'Check for Updates…',
    upToDate: "You're on the latest version of Surco.",
    updatesDevOnly: 'Updates are only available in the installed app.',
    conflictExists: 'A file with this name already exists in the destination folder.',
    conflictReserved:
      'Another track in this conversion is being saved under this same name and has not been written yet. Overwrite or Keep both saves this one with a number added to its name.',
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
    traktorQuitMessage: 'Traktor is open',
    traktorQuitDetail:
      'Surco needs to close it to write into collection.nml. Traktor will quit safely; reopen it once the conversion finishes.',
    traktorQuitConfirm: 'Close Traktor',
    traktorQuitCancel: 'Cancel',
    traktorSyncBlocked: "Traktor's collection was not updated: Traktor is still open.",
    rekordboxQuitMessage: 'rekordbox is open',
    rekordboxQuitDetail:
      'Surco needs to close it to update your collection so it points at the new file. rekordbox will be closed safely; you can reopen it once the conversion finishes.',
    rekordboxQuitConfirm: 'Close rekordbox',
    rekordboxQuitCancel: 'Cancel',
    rekordboxSyncBlocked:
      "rekordbox's collection was not updated: rekordbox is still open. Close it and convert again so it points at the new file.",
    quitBusyMessage: 'Conversions are still running',
    quitBusyDetail:
      'Quitting now stops {n} conversions, and the tracks still queued will be left unconverted.',
    quitBusyConfirm: 'Quit anyway',
    quitBusyCancel: 'Keep converting',
    dialogConfigDir: 'Settings folder',
    dialogPickTracks: 'Choose tracks',
    dialogOutputDir: 'Output folder',
    dialogEngineLibrary: 'Engine DJ library',
    dialogTraktorCollection: 'Traktor collection',
    dialogRekordboxCollection: 'rekordbox collection',
    dialogExportCover: 'Export the artwork',
    dialogExportRekordbox: 'Export to rekordbox',
    dialogExportTraktor: 'Export to Traktor',
    dialogExportSerato: 'Export to Serato',
    dialogSaveQualityReport: 'Save the quality report',
    dialogSaveStats: 'Save your stats',
    dialogStatsFileName: 'My Surco stats.png',
    dialogExportM3u: 'Export to M3U8',
    dialogExportSettings: 'Export the settings',
    dialogImportSettings: 'Import the settings',
  },
  de: {
    settings: 'Einstellungen…',
    feedback: 'Feedback senden…',
    file: 'Datei',
    add: 'Tracks hinzufügen…',
    info: 'Informationen',
    reveal: 'Im Finder zeigen',
    rename: 'Dateinamen erstellen…',
    findReplace: 'Suchen & Ersetzen…',
    addAppleMusic: 'Zu Apple Music hinzufügen',
    remove: 'Aus der Liste entfernen',
    removeAll: 'Liste leeren',
    processCurrent: 'Track konvertieren',
    processAll: 'Alle konvertieren',
    view: 'Ansicht',
    palette: 'Befehlspalette',
    activity: 'Aktivität',
    backups: 'Sicherungskopien',
    stats: 'Statistiken',
    tracks: 'Tracks',
    analyzeQuality: 'Qualität analysieren',
    selectAllTracks: 'Alle Tracks auswählen',
    fillAll: 'Alle Tags aus dem Dateinamen füllen…',
    trashSelected: 'Auswahl in den Papierkorb legen…',
    search: 'In der Trackliste suchen',
    play: 'Abspielen / Pause',
    prev: 'Vorheriger Track',
    next: 'Nächster Track',
    help: 'Hilfe',
    faq: 'Häufige Fragen',
    guide: 'Benutzerhandbuch',
    setupAssistant: 'Einrichtungsassistent…',
    website: 'Surco-Website',
    aboutCredits:
      'Mit Sorgfalt gemacht von Vicent Gozalbes\nvigosan@gmail.com\n\nDanke an @djotas und alle, die Ideen\nund Feedback beisteuern.\n\ngetsurco.app',
    checkUpdates: 'Nach Updates suchen…',
    upToDate: 'Du hast bereits die neueste Version von Surco.',
    updatesDevOnly: 'Updates sind nur in der installierten App verfügbar.',
    conflictExists: 'Im Zielordner existiert bereits eine Datei mit diesem Namen.',
    conflictReserved:
      'Ein anderer Track dieser Konvertierung wird unter demselben Namen gespeichert und ist noch nicht geschrieben. Mit Überschreiben oder Beide behalten wird dieser mit einer angehängten Nummer gespeichert.',
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
    traktorQuitMessage: 'Traktor ist geöffnet',
    traktorQuitDetail:
      'Surco muss es schließen, um in collection.nml zu schreiben. Traktor wird sicher beendet; du kannst es nach der Konvertierung wieder öffnen.',
    traktorQuitConfirm: 'Traktor schließen',
    traktorQuitCancel: 'Abbrechen',
    traktorSyncBlocked: 'Die Traktor-Sammlung wurde nicht aktualisiert: Traktor ist noch geöffnet.',
    rekordboxQuitMessage: 'rekordbox ist geöffnet',
    rekordboxQuitDetail:
      'Surco muss es schließen, um deine Sammlung zu aktualisieren, damit sie auf die neue Datei zeigt. rekordbox wird sicher geschlossen; du kannst es nach der Konvertierung wieder öffnen.',
    rekordboxQuitConfirm: 'rekordbox schließen',
    rekordboxQuitCancel: 'Abbrechen',
    rekordboxSyncBlocked:
      'Die rekordbox-Sammlung wurde nicht aktualisiert: rekordbox ist noch geöffnet. Schließe es und konvertiere erneut, damit es auf die neue Datei zeigt.',
    quitBusyMessage: 'Es laufen noch Konvertierungen',
    quitBusyDetail:
      'Beim Beenden werden {n} Konvertierungen gestoppt, und die noch wartenden Titel bleiben unkonvertiert.',
    quitBusyConfirm: 'Trotzdem beenden',
    quitBusyCancel: 'Weiter konvertieren',
    dialogConfigDir: 'Einstellungsordner',
    dialogPickTracks: 'Tracks auswählen',
    dialogOutputDir: 'Ausgabeordner',
    dialogEngineLibrary: 'Engine-DJ-Bibliothek',
    dialogTraktorCollection: 'Traktor-Sammlung',
    dialogRekordboxCollection: 'rekordbox-Sammlung',
    dialogExportCover: 'Cover exportieren',
    dialogExportRekordbox: 'Nach rekordbox exportieren',
    dialogExportTraktor: 'Nach Traktor exportieren',
    dialogExportSerato: 'Nach Serato exportieren',
    dialogSaveQualityReport: 'Qualitätsbericht speichern',
    dialogSaveStats: 'Deine Statistik speichern',
    dialogStatsFileName: 'Meine Surco-Statistik.png',
    dialogExportM3u: 'Als M3U8 exportieren',
    dialogExportSettings: 'Einstellungen exportieren',
    dialogImportSettings: 'Einstellungen importieren',
  },
  fr: {
    settings: 'Réglages…',
    feedback: 'Envoyer un retour…',
    file: 'Fichier',
    add: 'Ajouter des morceaux…',
    info: 'Informations',
    reveal: 'Afficher dans le Finder',
    rename: 'Composer le nom du fichier…',
    findReplace: 'Rechercher et remplacer…',
    addAppleMusic: 'Ajouter à Apple Music',
    remove: 'Retirer de la liste',
    removeAll: 'Vider la liste',
    processCurrent: 'Convertir le morceau',
    processAll: 'Tout convertir',
    view: 'Présentation',
    palette: 'Palette de commandes',
    activity: 'Activité',
    backups: 'Copies de sauvegarde',
    stats: 'Statistiques',
    tracks: 'Morceaux',
    analyzeQuality: 'Analyser la qualité',
    selectAllTracks: 'Sélectionner tous les morceaux',
    fillAll: 'Remplir tous les tags depuis le nom du fichier…',
    trashSelected: 'Mettre la sélection à la corbeille…',
    search: 'Rechercher dans la liste des morceaux',
    play: 'Lecture / pause',
    prev: 'Morceau précédent',
    next: 'Morceau suivant',
    help: 'Aide',
    faq: 'Questions fréquentes',
    guide: "Guide d'utilisation",
    setupAssistant: 'Assistant de configuration…',
    website: 'Site web de Surco',
    aboutCredits:
      'Fait avec soin par Vicent Gozalbes\nvigosan@gmail.com\n\nMerci à @djotas et à toutes les personnes\nqui partagent idées et retours.\n\ngetsurco.app',
    checkUpdates: 'Rechercher les mises à jour…',
    upToDate: 'Tu as déjà la dernière version de Surco.',
    updatesDevOnly: "Les mises à jour ne sont disponibles que dans l'app installée.",
    conflictExists: 'Un fichier du même nom existe déjà dans le dossier de destination.',
    conflictReserved:
      "Un autre morceau de cette conversion va être enregistré sous ce même nom et n'est pas encore écrit. Avec Écraser ou Conserver les deux, celui-ci est enregistré avec un numéro ajouté à son nom.",
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
    traktorQuitMessage: 'Traktor est ouvert',
    traktorQuitDetail:
      'Surco doit le fermer pour écrire dans collection.nml. Traktor sera fermé proprement ; tu pourras le rouvrir à la fin de la conversion.',
    traktorQuitConfirm: 'Fermer Traktor',
    traktorQuitCancel: 'Annuler',
    traktorSyncBlocked:
      "La collection Traktor n'a pas été mise à jour : Traktor est encore ouvert.",
    rekordboxQuitMessage: 'rekordbox est ouvert',
    rekordboxQuitDetail:
      'Surco doit le fermer pour mettre à jour ta collection et la faire pointer vers le nouveau fichier. rekordbox sera fermé proprement ; tu pourras le rouvrir une fois la conversion terminée.',
    rekordboxQuitConfirm: 'Fermer rekordbox',
    rekordboxQuitCancel: 'Annuler',
    rekordboxSyncBlocked:
      "La collection rekordbox n'a pas été mise à jour : rekordbox est encore ouvert. Ferme-le et relance la conversion pour qu'il pointe vers le nouveau fichier.",
    quitBusyMessage: 'Des conversions sont en cours',
    quitBusyDetail:
      'Quitter maintenant arrête {n} conversions, et les morceaux en attente resteront non convertis.',
    quitBusyConfirm: 'Quitter quand même',
    quitBusyCancel: 'Continuer la conversion',
    dialogConfigDir: 'Dossier de configuration',
    dialogPickTracks: 'Choisis des morceaux',
    dialogOutputDir: 'Dossier de sortie',
    dialogEngineLibrary: 'Bibliothèque Engine DJ',
    dialogTraktorCollection: 'Collection Traktor',
    dialogRekordboxCollection: 'Collection rekordbox',
    dialogExportCover: 'Exporter la pochette',
    dialogExportRekordbox: 'Exporter vers rekordbox',
    dialogExportTraktor: 'Exporter vers Traktor',
    dialogExportSerato: 'Exporter vers Serato',
    dialogSaveQualityReport: 'Enregistrer le rapport de qualité',
    dialogSaveStats: 'Enregistrer tes statistiques',
    dialogStatsFileName: 'Mes statistiques Surco.png',
    dialogExportM3u: 'Exporter en M3U8',
    dialogExportSettings: 'Exporter la configuration',
    dialogImportSettings: 'Importer la configuration',
  },
  'pt-BR': {
    settings: 'Ajustes…',
    feedback: 'Enviar feedback…',
    file: 'Arquivo',
    add: 'Adicionar faixas…',
    info: 'Informações',
    reveal: 'Mostrar no Finder',
    rename: 'Gerar nome do arquivo…',
    findReplace: 'Localizar e substituir…',
    addAppleMusic: 'Adicionar ao Apple Music',
    remove: 'Remover da lista',
    removeAll: 'Limpar a lista',
    processCurrent: 'Converter faixa',
    processAll: 'Converter tudo',
    view: 'Visualizar',
    palette: 'Paleta de comandos',
    activity: 'Atividade',
    backups: 'Cópias de segurança',
    stats: 'Estatísticas',
    tracks: 'Faixas',
    analyzeQuality: 'Analisar qualidade',
    selectAllTracks: 'Selecionar todas as faixas',
    fillAll: 'Preencher tudo a partir do nome…',
    trashSelected: 'Mover a seleção para a lixeira…',
    search: 'Buscar na lista de faixas',
    play: 'Reproduzir / pausar',
    prev: 'Faixa anterior',
    next: 'Próxima faixa',
    help: 'Ajuda',
    faq: 'Perguntas frequentes',
    guide: 'Guia de uso',
    setupAssistant: 'Assistente de configuração…',
    website: 'Site do Surco',
    aboutCredits:
      'Feito com carinho por Vicent Gozalbes\nvigosan@gmail.com\n\nObrigado a @djotas e a todos que\ncompartilham ideias e feedback.\n\ngetsurco.app',
    checkUpdates: 'Buscar atualizações…',
    upToDate: 'Você já tem a versão mais recente do Surco.',
    updatesDevOnly: 'As atualizações só estão disponíveis no app instalado.',
    conflictExists: 'Já existe um arquivo com esse nome na pasta de destino.',
    conflictReserved:
      'Outra faixa desta conversão vai ser salva com esse mesmo nome e ainda não foi gravada. Com Sobrescrever ou Manter ambos, esta é salva com um número adicionado ao nome.',
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
    traktorQuitMessage: 'O Traktor está aberto',
    traktorQuitDetail:
      'O Surco precisa fechá-lo para escrever no collection.nml. O Traktor será fechado com segurança; você pode reabri-lo quando a conversão terminar.',
    traktorQuitConfirm: 'Fechar o Traktor',
    traktorQuitCancel: 'Cancelar',
    traktorSyncBlocked: 'A coleção do Traktor não foi atualizada: o Traktor ainda está aberto.',
    rekordboxQuitMessage: 'O rekordbox está aberto',
    rekordboxQuitDetail:
      'O Surco precisa fechá-lo para atualizar a sua coleção e apontar para o arquivo novo. O rekordbox será fechado com segurança; você pode reabri-lo quando a conversão terminar.',
    rekordboxQuitConfirm: 'Fechar o rekordbox',
    rekordboxQuitCancel: 'Cancelar',
    rekordboxSyncBlocked:
      'A coleção do rekordbox não foi atualizada: o rekordbox ainda está aberto. Feche-o e converta de novo para que aponte para o arquivo novo.',
    quitBusyMessage: 'Ainda há conversões em andamento',
    quitBusyDetail:
      'Sair agora interrompe {n} conversões, e as faixas na fila ficarão sem converter.',
    quitBusyConfirm: 'Sair mesmo assim',
    quitBusyCancel: 'Continuar convertendo',
    dialogConfigDir: 'Pasta de configuração',
    dialogPickTracks: 'Escolha faixas',
    dialogOutputDir: 'Pasta de saída',
    dialogEngineLibrary: 'Biblioteca do Engine DJ',
    dialogTraktorCollection: 'Coleção do Traktor',
    dialogRekordboxCollection: 'Coleção do rekordbox',
    dialogExportCover: 'Exportar a capa',
    dialogExportRekordbox: 'Exportar para o rekordbox',
    dialogExportTraktor: 'Exportar para o Traktor',
    dialogExportSerato: 'Exportar para o Serato',
    dialogSaveQualityReport: 'Salvar o relatório de qualidade',
    dialogSaveStats: 'Salvar suas estatísticas',
    dialogStatsFileName: 'Minhas estatísticas do Surco.png',
    dialogExportM3u: 'Exportar para M3U8',
    dialogExportSettings: 'Exportar a configuração',
    dialogImportSettings: 'Importar a configuração',
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
