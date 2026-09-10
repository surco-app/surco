// Automatic codec-direction calibration measured against Traktor. This is the
// marker movement the user must observe; cueShiftFor subtracts it from its shift.
// The visible manual slider remains a separate additive correction and starts at 0.
export function automaticCueOffsetMs(inputExt: string, outputExt: string): number {
  const input = inputExt.toLowerCase().startsWith('.')
    ? inputExt.toLowerCase()
    : `.${inputExt.toLowerCase()}`
  const output = outputExt.toLowerCase().startsWith('.')
    ? outputExt.toLowerCase()
    : `.${outputExt.toLowerCase()}`
  if (output === '.mp3' && ['.flac', '.aif', '.aiff', '.wav'].includes(input)) return 51
  if (input === '.mp3' && ['.flac', '.aif', '.aiff'].includes(output)) return -51
  return 0
}
