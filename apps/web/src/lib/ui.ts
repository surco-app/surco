// Shared primary-button recipe so the three CTAs (hero download, pricing donate,
// header donate) keep one identical interaction — color, shadow, hover lift +
// shadow swap, and press — and diverge only in the display/size utilities each
// call site appends. Display is left out so a site can stay responsive (the
// header donate is `hidden … sm:inline-flex`).
export const btnPrimary =
  'items-center justify-center rounded-full bg-blue font-semibold text-bg shadow-lg shadow-blue/20 transition-[background-color,box-shadow,translate,scale] duration-200 hover:bg-cyan hover:shadow-xl hover:shadow-cyan/25 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.96]'
