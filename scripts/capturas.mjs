// Abre Taller con Ollama y ComfyUI simulados, lo recorre y guarda capturas en capturas/.
//   npm run build && npm run capturas
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'
import { crearComfySimulado } from './comfyui-simulado.mjs'
import { crearOllamaSimulado } from './ollama-simulado.mjs'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const salida = join(raiz, 'capturas')
const solo = process.argv.slice(2).find((a) => !a.startsWith('--'))

const escuchar = (s, p) => new Promise((ok) => s.listen(p, '127.0.0.1', ok))
const ollama = crearOllamaSimulado({ demora: 18 })
const ollamaVacio = crearOllamaSimulado({ vacio: true })
const comfy = crearComfySimulado({ paso: 110 })
await escuchar(ollama, 11500)
await escuchar(ollamaVacio, 11501)
await escuchar(comfy, 8190)

const datos = await mkdtemp(join(tmpdir(), 'taller-datos-'))
const proyecto = await mkdtemp(join(tmpdir(), 'mi-proyecto-'))
await mkdir(join(proyecto, 'src'), { recursive: true })
await writeFile(join(proyecto, 'README.md'), '# Mi proyecto\n\nUna API pequeña de tareas.\n')
await writeFile(join(proyecto, 'package.json'), '{ "name": "mi-proyecto", "version": "1.0.0" }\n')
await writeFile(join(proyecto, 'src', 'app.js'), "// TODO: validar la entrada\nexport function sumar(a, b) {\n  return a + b // FIXME: números grandes\n}\n")
await mkdir(salida, { recursive: true })

// Con --video graba el recorrido en capturas/video (webm) para ver las animaciones
const video = process.argv.includes('--video')
const app = await electron.launch({
  args: [raiz],
  cwd: raiz,
  env: { ...process.env, TALLER_DATOS: datos, TALLER_OLLAMA_URL: 'http://127.0.0.1:11500', TALLER_COMFY_URL: 'http://127.0.0.1:8190' },
  ...(video ? { recordVideo: { dir: join(salida, 'video'), size: { width: 1320, height: 860 } } } : {})
})
const win = await app.firstWindow()
// La pantalla de arranque dura poco: se retrata antes que nada, si se alcanza
await win
  .waitForSelector('.arranque .logo', { timeout: 4000 })
  .then(() => win.screenshot({ path: join(salida, '00-arranque.png') }))
  .then(() => console.log('captura 00-arranque'))
  .catch(() => console.log('(la pantalla de arranque pasó muy rápido)'))
win.on('console', (m) => m.type() === 'error' && console.log('[consola]', m.text()))
win.on('pageerror', (e) => console.log('[error de página]', e.message))
await app.evaluate(({ BrowserWindow, nativeTheme }) => {
  nativeTheme.themeSource = 'light'
  const w = BrowserWindow.getAllWindows()[0]
  w.setSize(1320, 860)
  w.center()
})

const espera = (ms) => new Promise((r) => setTimeout(r, ms))
async function foto(nombre) {
  if (solo && !nombre.startsWith(solo)) return
  await espera(350)
  await win.screenshot({ path: join(salida, `${nombre}.png`) })
  console.log('captura', nombre)
}
// Espera a que el agente arranque y termine
async function terminar(timeout = 30000) {
  await win.waitForSelector('.enviar.detener', { timeout: 5000 }).catch(() => undefined)
  await win.waitForSelector('.enviar:not(.detener)', { timeout })
}
const ajustar = (cambios) =>
  win.evaluate(async (c) => {
    const a = await window.taller.ajustes()
    await window.taller.guardarAjustes({ ...a, ...c })
  }, cambios)

try {
  // El agente trabaja en la carpeta de prueba (el diálogo nativo de carpetas no se puede automatizar)
  await win.waitForSelector('.lateral')
  await ajustar({ carpetaSalidas: proyecto })
  await win.reload()

  // La primera vez sale el recorrido guiado
  const siguiente = async (veces = 1) => {
    for (let n = 0; n < veces; n++) await win.click('.tutorial-tarjeta .boton.primario')
    await espera(450)
  }
  await win.waitForSelector('.tutorial-tarjeta')
  await espera(900)
  await foto('tutorial-1-bienvenida')
  await siguiente(2)
  await foto('tutorial-2-modelo')
  await siguiente()
  await foto('tutorial-3-modos')
  await siguiente(3)
  await foto('tutorial-4-compositor')
  await siguiente(2)
  await foto('tutorial-5-modelos')
  await siguiente(2)
  await foto('tutorial-6-listo')
  await win.click('.tutorial-tarjeta .boton.primario')
  await win.waitForSelector('.tutorial', { state: 'detached' })

  await win.waitForSelector('text=¿Qué hacemos hoy?')
  await foto('01-inicio')

  await win.click('.selector-boton')
  await win.waitForSelector('.menu')
  await foto('02-selector-modelos')

  await win.click('.opcion-modelo:has-text("gemma3:12b")')
  await win.click('.modo:has-text("Agente")')
  await win.waitForSelector('.explicacion')
  await foto('03-funcion-bloqueada')
  await win.click('.explicacion button:has-text("Usar qwen3.5:9b")')
  await win.click('.modo:has-text("Agente")')

  await win.fill('.compositor textarea', 'Crea un archivo hola mundo en JavaScript y pruébalo')
  await win.keyboard.press('Enter')
  await win.waitForSelector('.permiso')
  await foto('04-permiso')
  await win.click('.permiso button:has-text("Permitir siempre")')
  await win.waitForSelector('.permiso:has-text("comando")')
  await win.click('.permiso button:has-text("Permitir")')
  await terminar()
  await win.click('.herramienta:has-text("node hola.js") > button')
  await foto('05-agente')

  await win.click('.boton-nueva')
  await win.fill('.compositor textarea', 'Explícame la estructura de este proyecto')
  await win.keyboard.press('Enter')
  await terminar()
  await win.fill('.compositor textarea', 'Busca los TODO')
  await win.keyboard.press('Enter')
  await terminar()
  await win.waitForSelector('.md table')
  await foto('06-explorar')

  await win.click('.boton-nueva')
  await win.click('.modo:has-text("Imagen")')
  await win.fill('.compositor textarea', 'Un taller de carpintería al atardecer, estilo acuarela')
  await win.keyboard.press('Enter')
  await win.waitForSelector('.generacion .barra-progreso')
  await foto('07-imagen-progreso')
  await win.waitForSelector('.generacion img.resultado-imagen', { timeout: 30000 })
  await foto('08-imagen')

  await win.click('.boton-nueva')
  await win.click('.modo:has-text("3D")')
  await win.fill('.compositor textarea', 'Una taza con forma de cactus')
  await win.keyboard.press('Enter')
  await win.waitForSelector('.generacion .forja3d')
  await win.waitForSelector('.generacion img.resultado-imagen', { timeout: 30000 })
  await espera(900)
  await foto('09a-3d-progreso')
  await win.waitForSelector('.generacion .visor3d canvas', { timeout: 40000 })
  await espera(1500)
  await foto('09-modelo-3d')

  await win.click('.enlace-lateral:has-text("Modelos")')
  await win.waitForSelector('.matriz')
  await foto('10-modelos')

  await win.click('.enlace-lateral:has-text("Ajustes")')
  await foto('11-ajustes')

  await ajustar({ tema: 'oscuro' })
  await win.reload()
  await win.waitForSelector('.lateral')
  await win.click('.conversacion:has-text("Crea un archivo")')
  await win.waitForSelector('.herramienta')
  await foto('12-oscuro')

  await ajustar({ tema: 'claro', ollamaUrl: 'http://127.0.0.1:9' })
  await win.reload()
  await win.waitForSelector('.lateral')
  await win.click('.boton-nueva')
  await win.waitForSelector('.tarjeta h2')
  await foto('13-sin-ollama')

  await ajustar({ ollamaUrl: 'http://127.0.0.1:11501' })
  await win.reload()
  await win.waitForSelector('text=no tiene modelos')
  await foto('14-sin-modelos')
  await win.click('.sugerido button:has-text("Descargar")')
  await win.waitForSelector('.sugerido .barra-progreso')
  await foto('15-descargando')
  await win.waitForSelector('text=¿Qué hacemos hoy?', { timeout: 30000 })
  await foto('16-modelo-listo')
} finally {
  await app.close()
  for (const s of [ollama, ollamaVacio, comfy]) {
    s.closeAllConnections()
    s.close()
  }
  await rm(datos, { recursive: true, force: true })
  await rm(proyecto, { recursive: true, force: true })
}
