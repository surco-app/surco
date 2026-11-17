import { app, BrowserWindow } from 'electron'

if (process.platform === 'darwin') app.setActivationPolicy('accessory')
BrowserWindow.getFocusedWindow = () => BrowserWindow.getAllWindows()[0] ?? null
await import(process.env.SURCO_MAIN_ENTRY)
