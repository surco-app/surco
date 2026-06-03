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

export function runCommand(commands: Command[], id: string): void {
  const c = commands.find((c) => c.id === id)
  if (c?.enabled) c.run()
}
