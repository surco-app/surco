// Whether the last thing the user did was press a key rather than point, read by surfaces
// that answer a keystroke without an entrance (see ModalShell). Tracked in the capture phase
// so a handler that stops propagation can't hide the input from it.
let keyboard = false

window.addEventListener(
  'keydown',
  () => {
    keyboard = true
  },
  true,
)
window.addEventListener(
  'pointerdown',
  () => {
    keyboard = false
  },
  true,
)

export function lastInputWasKeyboard(): boolean {
  return keyboard
}
