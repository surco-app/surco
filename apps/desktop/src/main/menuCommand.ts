// Accelerators listed here are owned by the renderer keymap, which alone applies
// the "not while typing in a field" guard. registerAccelerator:false keeps them
// out of the macOS system map so the keystroke still reaches the renderer, but
// Cocoa nonetheless invokes the menu item's click for the key — which would
// bypass that guard (Space would start playback mid-search). So a click that was
// triggered by the keyboard accelerator is ignored and left to the keymap; only
// an explicit mouse click of the menu item runs the command.
export function keymapMenuClick(
  run: (id: string) => void,
  id: string,
): (menuItem: unknown, window: unknown, event: { triggeredByAccelerator?: boolean }) => void {
  return (_menuItem, _window, event) => {
    if (event.triggeredByAccelerator) return
    run(id)
  }
}
