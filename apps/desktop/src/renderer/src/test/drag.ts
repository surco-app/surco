// jsdom has no DragEvent, and a drag event built as a plain Event drops its pointer
// position, which is what decides above or below a row. Call in beforeAll.
export function installDragEvent(): void {
  if (!('DragEvent' in window)) Object.assign(window, { DragEvent: class extends MouseEvent {} })
}

// What fireEvent needs as a drag's dataTransfer. setData records its type the way a browser
// does; files arrive under the 'Files' type, as a drop from Finder does.
export function fakeDataTransfer(files: File[] = []) {
  const data: Record<string, string> = {}
  return {
    effectAllowed: '',
    types: (files.length ? ['Files'] : []) as string[],
    files,
    items: files.map(() => ({ kind: 'file' })),
    setData(type: string, value: string) {
      data[type] = value
      this.types.push(type)
    },
    getData: (type: string) => data[type] ?? '',
  }
}
