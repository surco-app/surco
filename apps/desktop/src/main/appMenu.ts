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
  return [
    {
      label: appName,
      submenu: [
        { role: 'about' },
        { label: t('checkUpdates'), click: checkForUpdates },
        { type: 'separator' },
        {
          label: t('settings'),
          accelerator: accel('settings'),
          registerAccelerator: false,
          click: keymapMenuClick(run, 'settings'),
        },
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
        {
          label: t('add'),
          accelerator: accel('add'),
          registerAccelerator: false,
          click: keymapMenuClick(run, 'add'),
        },
        {
          label: t('info'),
          accelerator: accel('info'),
          registerAccelerator: false,
          click: keymapMenuClick(run, 'info'),
        },
        // Reveal is renderer-owned like the others now (it used to register ⌘R itself):
        // its chord is configurable, so the keystroke must reach the keymap, not the menu.
        {
          label: t('reveal'),
          accelerator: accel('reveal'),
          registerAccelerator: false,
          click: keymapMenuClick(run, 'reveal'),
        },
        {
          label: t('rename'),
          accelerator: accel('rename'),
          registerAccelerator: false,
          click: keymapMenuClick(run, 'rename'),
        },
        {
          label: t('findReplace'),
          accelerator: accel('find-replace'),
          registerAccelerator: false,
          click: keymapMenuClick(run, 'find-replace'),
        },
        {
          label: t('addAppleMusic'),
          accelerator: accel('add-apple-music'),
          registerAccelerator: false,
          click: keymapMenuClick(run, 'add-apple-music'),
        },
        { type: 'separator' },
        {
          label: t('processCurrent'),
          accelerator: accel('process-current'),
          registerAccelerator: false,
          click: keymapMenuClick(run, 'process-current'),
        },
        {
          label: t('processAll'),
          accelerator: accel('process-all'),
          registerAccelerator: false,
          click: keymapMenuClick(run, 'process-all'),
        },
        { type: 'separator' },
        {
          label: t('remove'),
          accelerator: accel('remove'),
          registerAccelerator: false,
          click: keymapMenuClick(run, 'remove'),
        },
        { label: t('removeAll'), click: () => run('remove-all') },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    { role: 'editMenu' },
    {
      label: t('tracks'),
      submenu: [
        {
          label: t('selectAllTracks'),
          accelerator: accel('select-all'),
          registerAccelerator: false,
          click: keymapMenuClick(run, 'select-all'),
        },
        {
          label: t('fillAll'),
          accelerator: accel('fill-all'),
          registerAccelerator: false,
          click: keymapMenuClick(run, 'fill-all'),
        },
        { type: 'separator' },
        {
          label: t('analyzeQuality'),
          accelerator: accel('analyze-quality'),
          registerAccelerator: false,
          click: keymapMenuClick(run, 'analyze-quality'),
        },
        { type: 'separator' },
        {
          label: t('trashSelected'),
          accelerator: accel('trash-selected'),
          registerAccelerator: false,
          click: keymapMenuClick(run, 'trash-selected'),
        },
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
        {
          label: t('search'),
          accelerator: accel('search'),
          registerAccelerator: false,
          click: keymapMenuClick(run, 'search'),
        },
        {
          label: t('play'),
          accelerator: accel('play'),
          registerAccelerator: false,
          click: keymapMenuClick(run, 'play'),
        },
        {
          label: t('prev'),
          accelerator: accel('prev'),
          registerAccelerator: false,
          click: keymapMenuClick(run, 'prev'),
        },
        {
          label: t('next'),
          accelerator: accel('next'),
          registerAccelerator: false,
          click: keymapMenuClick(run, 'next'),
        },
        { type: 'separator' },
        {
          label: t('stats'),
          accelerator: accel('stats'),
          registerAccelerator: false,
          click: keymapMenuClick(run, 'stats'),
        },
        { label: t('activity'), click: () => run('activity') },
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
