// Shared primary-button recipe so the three CTAs (hero download, pricing donate,
// header donate) keep one identical interaction — fill, shadow, hover lift +
// glow swap, and press — and diverge only in the display/size utilities each
// call site appends. Display is left out so a site can stay responsive (the
// header donate is `hidden … sm:inline-flex`).
//
// The fill is the same blue→cyan as the brand `.text-grad` accent so the primary
// action reads as the one lit element on the page. Hover only brightens the
// colored glow and lifts — the gradient itself stays put (animating Tailwind's
// gradient custom properties snaps rather than tweens without an @property
// registration), so the transition is a clean shadow + translate.
export const btnPrimary =
  'items-center justify-center rounded-full bg-gradient-to-br from-blue to-cyan font-semibold text-bg shadow-lg shadow-blue/25 transition-[box-shadow,translate,scale] duration-200 hover:shadow-xl hover:shadow-cyan/35 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.96]'
