export interface Command {
  id: string
  title: string
  hint?: string
  enabled: boolean
  run: () => void
}

export function filterCommands(commands: Command[], query: string): Command[] {
  const q = query.trim().toLowerCase()
  if (!q) return commands
  return commands.filter((c) => c.title.toLowerCase().includes(q))
}
