// Pasa build/icon.svg a build/icon.png (512×512, fondo transparente) con el propio Electron.
//   npx electron scripts/icono.cjs
const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const raiz = join(__dirname, '..')
const svg = readFileSync(join(raiz, 'build', 'icon.svg'), 'utf8')
const html = `<html><body style="margin:0;background:transparent">${svg}</body></html>`

app.disableHardwareAcceleration()
app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 512,
    height: 512,
    show: false,
    transparent: true,
    frame: false,
    useContentSize: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true }
  })
  let listo = false
  win.webContents.on('paint', (_e, _sucio, imagen) => {
    if (listo || imagen.isEmpty()) return
    listo = true
    writeFileSync(join(raiz, 'build', 'icon.png'), imagen.resize({ width: 512, height: 512 }).toPNG())
    console.log('build/icon.png listo')
    app.quit()
  })
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
})
