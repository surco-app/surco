// Shared primary-button recipe so the three CTAs (hero download, pricing donate,
// header donate) keep one identical interaction — fill, hover brighten and press —
// and diverge only in the display/size utilities each call site appends. Display is
// left out so a site can stay responsive (the header donate is `hidden … sm:inline-flex`).
//
// The fill is the brand blue, flat like the app, so the primary action reads as the one
// filled element on the page with nothing decorative on it: no glow, no lift, no gradient.
// Hover brightens the fill, and Tailwind only applies hover where a pointer can hover.
export const btnPrimary =
  'items-center justify-center rounded-full bg-blue font-semibold text-bg transition-[filter,scale] duration-[160ms] ease-out hover:brightness-110 active:scale-[0.97]'
