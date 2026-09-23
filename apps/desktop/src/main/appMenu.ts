import type { createMenuT } from './i18n'
import { keymapMenuClick } from './menuCommand'

interface Params {
  appName: string
  t: ReturnType<typeof createMenuT>
  accel: (id: string) => string | undefined
  run: (id: string) => void
  checkForUpdates: () => void
}

export function appMenuTemplate({
  appName,
  t,
  accel,
  run,
  checkForUpdates,
}: Params): Electron.MenuItemConstructorOptions[] {
  const keymapItem = (label: string, id: string): Electron.MenuItemConstructorOptions => ({
    label,
    accelerator: accel(id),
    registerAccelerator: false,
    click: keymapMenuClick(run, id),
  })
  return [
    {
      label: appName,
      submenu: [
        { role: 'about' },
        { label: t('checkUpdates'), click: checkForUpdates },
        { type: 'separator' },
        keymapItem(t('settings'), 'settings'),
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: t('file'),
      submenu: [
        keymapItem(t('add'), 'add'),
        keymapItem(t('info'), 'info'),
        // Reveal is renderer-owned like the others now (it used to register ⌘R itself):
        // its chord is configurable, so the keystroke must reach the keymap, not the menu.
        keymapItem(t('reveal'), 'reveal'),
        keymapItem(t('rename'), 'rename'),
        keymapItem(t('findReplace'), 'find-replace'),
        keymapItem(t('addAppleMusic'), 'add-apple-music'),
        { type: 'separator' },
        keymapItem(t('processCurrent'), 'process-current'),
        keymapItem(t('processAll'), 'process-all'),
        { type: 'separator' },
        keymapItem(t('remove'), 'remove'),
        { label: t('removeAll'), click: () => run('remove-all') },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    { role: 'editMenu' },
    {
      label: t('tracks'),
      submenu: [
        keymapItem(t('selectAllTracks'), 'select-all'),
        keymapItem(t('fillAll'), 'fill-all'),
        { type: 'separator' },
        keymapItem(t('analyzeQuality'), 'analyze-quality'),
        { type: 'separator' },
        keymapItem(t('trashSelected'), 'trash-selected'),
      ],
    },
    {
      label: t('view'),
      submenu: [
        {
          label: t('palette'),
          accelerator: 'CmdOrCtrl+K',
          registerAccelerator: false,
          click: keymapMenuClick(run, 'palette'),
        },
        { type: 'separator' },
        keymapItem(t('search'), 'search'),
        keymapItem(t('play'), 'play'),
        keymapItem(t('prev'), 'prev'),
        keymapItem(t('next'), 'next'),
        { type: 'separator' },
        keymapItem(t('stats'), 'stats'),
        { label: t('activity'), click: () => run('activity') },
        { type: 'separator' },
        // Replacing Electron's default View menu dropped its zoom items, and with them the
        // only way to enlarge the interface; the roles restore ⌘+ / ⌘- / ⌘0 everywhere.
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      label: t('help'),
      submenu: [
        { label: t('faq'), click: () => run('help') },
        { label: t('guide'), click: () => run('guide') },
        { label: t('setupAssistant'), click: () => run('onboarding') },
        { type: 'separator' },
        { label: t('website'), click: () => run('website') },
        { label: t('feedback'), click: () => run('feedback') },
      ],
    },
  ]
}
