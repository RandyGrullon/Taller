// Pasa un SVG a PNG con el propio Electron (fondo transparente).
//   npx electron scripts/svg-a-png.cjs build/icon.svg build/icon.png 512 512
//   npx electron scripts/svg-a-png.cjs docs/banner.svg docs/banner.png 1600 520
const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync } = require('node:fs')
const { resolve } = require('node:path')

const [entrada, salida, ancho = '512', alto = '512'] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
if (!entrada || !salida) {
  console.error('Uso: npx electron scripts/svg-a-png.cjs <entrada.svg> <salida.png> [ancho] [alto]')
  process.exit(1)
}
const w = Number(ancho)
const h = Number(alto)
const svg = readFileSync(resolve(entrada), 'utf8')
// La ventana no puede ser más ancha que la pantalla: el SVG ocupa el ancho disponible
// manteniendo su proporción, y luego se recorta ese rectángulo
const html = `<html><head><style>html,body{margin:0;background:transparent;overflow:hidden}svg{display:block;width:100vw;height:auto}</style></head><body>${svg}</body></html>`

app.disableHardwareAcceleration()
app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: w,
    height: h,
    show: false,
    transparent: true,
    frame: false,
    useContentSize: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true }
  })
  win.webContents.setFrameRate(10)
  let ultima = null
  win.webContents.on('paint', (_e, _sucio, imagen) => {
    if (!imagen.isEmpty()) ultima = imagen
  })
  win.webContents.on('did-finish-load', async () => {
    // Se espera a que carguen las fuentes y se pinte un par de cuadros
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)')
    win.webContents.invalidate()
    setTimeout(() => {
      if (!ultima) {
        console.error('No se pintó nada.')
        app.exit(1)
        return
      }
      const ancho = ultima.getSize().width
      const recorte = ultima.crop({ x: 0, y: 0, width: ancho, height: Math.round((ancho * h) / w) })
      writeFileSync(resolve(salida), recorte.resize({ width: w, height: h, quality: 'best' }).toPNG())
      console.log(`${salida} listo (${w}×${h})`)
      app.quit()
    }, 500)
  })
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
})
