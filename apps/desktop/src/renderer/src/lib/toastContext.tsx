import { createContext, useContext } from 'react'

// The one way a component deep in the tree can say "this failed" out loud.
//
// The toast store lives in a useRef inside App, so anything below the first couple of
// levels had no route to it — and the sections that most need one (the quality report, the
// stats image, a dragged cover) are two and three hops down, behind intermediaries with no
// stake in the error. They each ended up swallowing failures into console.error, with
// comments admitting it: the user pressed the button, the spinner finished, no file
// appeared, and nothing was said.
//
// Deliberately narrower than the store: a component reports a failure, it does not get to
// drive the toast queue. Passing the store down instead would hand every leaf the power to
// dismiss other people's toasts.
export interface ToastReporter {
  // A failed action the user took, said in their language. Persistent and red: they should
  // see it before it goes.
  reportError: (message: string) => void
}

// Outside a provider the report still goes SOMEWHERE — the console — rather than throwing.
// A reporter that crashes the render when it can't reach the toast queue would turn "we
// couldn't tell you the save failed" into "the app is gone", which is a worse version of
// the bug it exists to fix. It also keeps a component testable in isolation without every
// test file having to mount the provider just to render a button.
const FALLBACK: ToastReporter = {
  reportError: (message) => console.error(message),
}

const ToastContext = createContext<ToastReporter>(FALLBACK)

export const ToastProvider = ToastContext.Provider

export function useToast(): ToastReporter {
  return useContext(ToastContext)
}
