/// <reference types="vite/client" />

declare module '*.json?slugs' {
  const cases: { id: string; slug: string }[]
  export default cases
}
