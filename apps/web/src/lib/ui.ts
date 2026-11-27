// Shared primary-button recipe so the three CTAs (hero download, pricing donate,
// header donate) keep one identical interaction — fill, hover fade and press —
// and diverge only in the display/size utilities each call site appends. Display is
// left out so a site can stay responsive (the header donate is `hidden … sm:inline-flex`).
//
// The fill is the page's ink, the dark button Cuts and Nada share, so the primary action
// reads as the one filled element on the page with nothing decorative on it: no glow, no
// lift, no gradient. Hover fades the fill, and Tailwind only applies hover where a pointer
// can hover.
export const btnPrimary =
  'items-center justify-center rounded-lg bg-fg font-medium text-bg transition-[opacity,scale] duration-150 ease-out hover:opacity-85 active:scale-[0.97]'

export const pressFeedback =
  'transition-[color,background-color,border-color,scale] duration-[160ms] ease-out active:scale-[0.97]'
