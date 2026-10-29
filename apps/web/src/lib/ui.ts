// Shared primary-button recipe so the three CTAs (hero download, pricing donate,
// header donate) keep one identical interaction — fill, hover brighten and press —
// and diverge only in the display/size utilities each call site appends. Display is
// left out so a site can stay responsive (the header donate is `hidden … sm:inline-flex`).
//
// The fill is the same blue→cyan as the brand `.text-grad` accent so the primary
// action reads as the one lit element on the page. The page is flat like the app, so
// the button carries no glow or lift: hover brightens the fill (animating Tailwind's
// gradient custom properties snaps rather than tweens without an @property
// registration, so the transition runs on the filter instead).
export const btnPrimary =
  'items-center justify-center rounded-full bg-gradient-to-br from-blue to-cyan font-semibold text-bg transition-[filter,scale] duration-200 hover:brightness-110 active:scale-[0.96]'
