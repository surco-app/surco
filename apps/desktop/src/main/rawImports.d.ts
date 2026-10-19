// The PowerShell query ships inside the main bundle as text (Vite's ?raw), so the very file
// the CI Windows job runs is the one the app runs.
declare module '*.ps1?raw' {
  const text: string
  export default text
}
