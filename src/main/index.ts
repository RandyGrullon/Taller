import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, net, protocol, shell } from 'electron'
import type { Ajustes, Entorno, Envio, ProgresoDescarga, RespuestaPermiso } from '@shared/tipos'
import type { CambiosConversacion } from '@shared/api'
import { Almacen, ajustesPorDefecto } from './almacen'
import { Comfy } from './comfy'
import { abrirOllama, detectarHardware, detectarOllama } from './deteccion'
import { GestorMcp } from './mcp'
import { Ollama } from './ollama'
import { GestorSesiones } from './sesiones'
import { validar } from './validador'

// Para pruebas: datos aparte y servidores simulados
if (process.env.TALLER_DATOS) app.setPath('userData', process.env.TALLER_DATOS)

protocol.registerSchemesAsPrivileged([
  { scheme: 'taller', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
])

const EXT_SERVIBLES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.glb': 'model/gltf-binary'
}

let ventana: BrowserWindow | null = null

async function iniciar() {
  const datos = app.getPath('userData')
  const almacen = new Almacen(datos, ajustesPorDefecto(join(app.getPath('documents'), 'Taller')))
  let ajustes = await almacen.leerAjustes()
  if (process.env.TALLER_OLLAMA_URL) ajustes.ollamaUrl = process.env.TALLER_OLLAMA_URL
  if (process.env.TALLER_COMFY_URL) ajustes.comfyUrl = process.env.TALLER_COMFY_URL
  nativeTheme.themeSource = ajustes.tema === 'sistema' ? 'system' : ajustes.tema === 'claro' ? 'light' : 'dark'

  let ollama = new Ollama(ajustes.ollamaUrl)
  let comfy = new Comfy(ajustes.comfyUrl)
  const mcp = new GestorMcp()
  void mcp.conectar(ajustes.mcpServers).catch(() => undefined)

  // La detección se reusa unos segundos para no golpear a Ollama en cada mensaje
  let entorno: { valor: Entorno; cuando: number } | null = null
  const detectar = async (forzar = false): Promise<Entorno> => {
    if (!forzar && entorno && Date.now() - entorno.cuando < 4000) return entorno.valor
    const [o, c, hardware] = await Promise.all([detectarOllama(ajustes.ollamaUrl, ollama), comfy.estado(), detectarHardware()])
    const valor: Entorno = { ollama: o, comfy: c, hardware: { ...hardware, gpu: hardware.gpu ?? c.gpu, vramGb: hardware.vramGb ?? c.vramGb }, mcp: mcp.estado() }
    entorno = { valor, cuando: Date.now() }
    return valor
  }

  const sesiones = new GestorSesiones({
    almacen,
    ajustes: () => ajustes,
    ollama: () => ollama,
    comfy: () => comfy,
    entorno: () => detectar(),
    mcp,
    dirAdjuntos: join(datos, 'adjuntos'),
    enviar: (id, e) => ventana?.webContents.send('conv:evento', id, e)
  })

  protocol.handle('taller', async (req) => {
    const ruta = new URL(req.url).searchParams.get('ruta') ?? ''
    const tipo = EXT_SERVIBLES[extname(ruta).toLowerCase()]
    if (!tipo) return new Response('No permitido', { status: 403 })
    const r = await net.fetch(pathToFileURL(ruta).toString()).catch(() => null)
    if (!r?.ok) return new Response('No existe', { status: 404 })
    // El visor 3D lo pide con fetch desde file:// (o localhost en desarrollo)
    return new Response(r.body, { headers: { 'Content-Type': tipo, 'Access-Control-Allow-Origin': '*' } })
  })

  ipcMain.handle('entorno:detectar', (_e, forzar?: boolean) => detectar(!!forzar))
  ipcMain.handle('ollama:abrir', async () => {
    const e = await detectar(true)
    if (e.ollama.estado !== 'apagado' || !e.ollama.ejecutable) return false
    abrirOllama(e.ollama.ejecutable)
    return true
  })

  const descargas = new Map<string, AbortController>()
  ipcMain.handle('ollama:descargar', async (_e, modelo: string) => {
    if (descargas.has(modelo)) return
    const ctl = new AbortController()
    descargas.set(modelo, ctl)
    const avisar = (p: ProgresoDescarga) => ventana?.webContents.send('descarga', p)
    try {
      for await (const p of ollama.descargar(modelo, ctl.signal)) {
        avisar({ modelo, estado: p.status, completado: p.completed, total: p.total })
      }
      avisar({ modelo, estado: 'listo', terminado: true })
    } catch (err) {
      const cancelada = (err as Error).name === 'AbortError'
      avisar({ modelo, estado: cancelada ? 'cancelada' : 'error', terminado: true, error: cancelada ? undefined : (err as Error).message })
    } finally {
      descargas.delete(modelo)
      entorno = null
    }
  })
  ipcMain.handle('ollama:cancelarDescarga', (_e, modelo: string) => descargas.get(modelo)?.abort())
  ipcMain.handle('ollama:borrar', async (_e, modelo: string) => {
    await ollama.borrar(modelo)
    entorno = null
  })

  ipcMain.handle('conv:listar', () => sesiones.listar())
  ipcMain.handle('conv:abrir', (_e, id: string) => sesiones.abrir(id))
  ipcMain.handle('conv:nueva', (_e, o) => sesiones.nueva(o ?? {}))
  ipcMain.handle('conv:actualizar', (_e, id: string, c: CambiosConversacion) => sesiones.actualizar(id, c))
  ipcMain.handle('conv:borrar', (_e, id: string) => sesiones.borrar(id))
  // No se espera: la respuesta llega por eventos
  ipcMain.handle('conv:enviar', (_e, id: string, envio: Envio) => void sesiones.enviar(id, envio).catch(() => undefined))
  ipcMain.handle('conv:detener', (_e, id: string) => sesiones.detener(id))
  ipcMain.handle('permiso:responder', (_e, id: string, r: RespuestaPermiso) => sesiones.responderPermiso(id, r))

  ipcMain.handle('dialogo:carpeta', async () => {
    const r = await dialog.showOpenDialog(ventana!, { title: 'Carpeta de trabajo', properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle('dialogo:imagen', async () => {
    const r = await dialog.showOpenDialog(ventana!, {
      title: 'Adjuntar imagen',
      properties: ['openFile'],
      filters: [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    })
    if (r.canceled) return null
    const ruta = r.filePaths[0]
    const ext = extname(ruta).slice(1).toLowerCase()
    const datos = await readFile(ruta)
    return `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${datos.toString('base64')}`
  })

  ipcMain.handle('ajustes:leer', () => ajustes)
  ipcMain.handle('ajustes:guardar', async (_e, a: Ajustes) => {
    ajustes = { ...ajustes, ...a }
    await almacen.guardarAjustes(ajustes)
    ollama = new Ollama(ajustes.ollamaUrl)
    comfy = new Comfy(ajustes.comfyUrl)
    nativeTheme.themeSource = ajustes.tema === 'sistema' ? 'system' : ajustes.tema === 'claro' ? 'light' : 'dark'
    entorno = null
    void mcp.conectar(ajustes.mcpServers).then(() => (entorno = null))
    return ajustes
  })
  ipcMain.handle('mcp:recargar', async () => {
    await mcp.recargar(ajustes.mcpServers)
    entorno = null
  })
  ipcMain.handle('mcp:proyecto', async (_e, carpeta: string) => {
    const texto = await readFile(join(carpeta, '.mcp.json'), 'utf8').catch(() => null)
    if (!texto) return null
    try {
      return JSON.parse(texto).mcpServers ?? null
    } catch {
      return null
    }
  })
  // Validador
  let validacion: AbortController | null = null
  ipcMain.handle('validador:correr', async (_e, preferido?: string) => {
    validacion?.abort()
    const ctl = new AbortController()
    validacion = ctl
    entorno = null
    try {
      return await validar(preferido, {
        ollama,
        comfy,
        ajustes,
        version: app.getVersion(),
        electron: process.versions.electron,
        mcp: async () => {
          await mcp.conectar(ajustes.mcpServers).catch(() => undefined)
          return mcp.estado()
        },
        dirDatos: datos,
        probarProtocolo: async (ruta) => {
          const r = await net.fetch(`taller://archivo/?ruta=${encodeURIComponent(ruta)}`).catch(() => null)
          return !!r?.ok && (await r.arrayBuffer()).byteLength > 0
        },
        signal: ctl.signal,
        alCambiar: (p) => ventana?.webContents.send('validador:progreso', p)
      })
    } finally {
      if (validacion === ctl) validacion = null
    }
  })
  ipcMain.handle('validador:detener', () => validacion?.abort())
  ipcMain.handle('validador:copiar', (_e, texto: string) => clipboard.writeText(texto))
  ipcMain.handle('validador:guardar', async (_e, texto: string) => {
    const dir = join(app.getPath('documents'), 'Taller')
    await mkdir(dir, { recursive: true })
    const ruta = join(dir, `validacion-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.md`)
    await writeFile(ruta, texto, 'utf8')
    shell.showItemInFolder(ruta)
    return ruta
  })
  ipcMain.handle('datos:abrir', async () => {
    const dir = join(datos, 'conversaciones')
    await mkdir(dir, { recursive: true })
    await shell.openPath(dir)
  })

  ipcMain.handle('externo:abrir', (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) return shell.openExternal(url)
  })
  ipcMain.handle('archivo:mostrar', (_e, ruta: string) => shell.showItemInFolder(ruta))

  app.on('before-quit', () => {
    void sesiones.cerrar()
    void mcp.cerrar()
  })

  crearVentana()
}

function crearVentana() {
  ventana = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 920,
    minHeight: 600,
    title: 'Taller',
    show: false,
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1a17' : '#faf8f5',
    icon: join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })
  ventana.on('ready-to-show', () => ventana?.show())
  ventana.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  ventana.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(process.env.ELECTRON_RENDERER_URL ?? 'file://')) e.preventDefault()
  })
  if (process.env.ELECTRON_RENDERER_URL) void ventana.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void ventana.loadFile(join(__dirname, '../renderer/index.html'))
  ventana.on('closed', () => (ventana = null))
}

app.whenReady().then(iniciar)
app.on('window-all-closed', () => app.quit())
