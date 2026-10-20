// ComfyUI simulado: /system_stats, /models/checkpoints, /object_info, /upload/image, /prompt,
// /history, /view, /ws, /interrupt y /free. En vez de SDXL y Hunyuan3D pinta un paisaje y una "gota" 3D.
//   node scripts/comfyui-simulado.mjs [--puerto 8188] [--sin-3d]
import { createHash, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { glb, png } from './lib/medios.mjs'

const NODOS_3D = ['ImageOnlyCheckpointLoader', 'Hunyuan3Dv2Conditioning', 'EmptyLatentHunyuan3Dv2', 'VAEDecodeHunyuan3D', 'VoxelToMesh', 'SaveGLB']

const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

function json(res, codigo, obj) {
  res.writeHead(codigo, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(obj))
}

function leer(req) {
  return new Promise((ok) => {
    const partes = []
    req.on('data', (c) => partes.push(c))
    req.on('end', () => ok(Buffer.concat(partes)))
  })
}

/** Saca el primer archivo de un multipart/form-data. */
function archivoMultipart(req, cuerpo) {
  const limite = /boundary=(?:"([^"]+)"|([^;]+))/.exec(req.headers['content-type'] ?? '')
  if (!limite) return null
  const sep = Buffer.from('--' + (limite[1] ?? limite[2]))
  let i = cuerpo.indexOf(sep)
  while (i >= 0) {
    const sig = cuerpo.indexOf(sep, i + sep.length)
    if (sig < 0) break
    const parte = cuerpo.subarray(i + sep.length + 2, sig - 2)
    const finCab = parte.indexOf('\r\n\r\n')
    const cab = parte.subarray(0, finCab).toString()
    const nombre = /filename="([^"]+)"/.exec(cab)?.[1]
    if (nombre) return { nombre, datos: parte.subarray(finCab + 4) }
    i = sig
  }
  return null
}

/** Marco de texto de WebSocket (servidor → cliente, sin máscara). */
function marco(texto) {
  const datos = Buffer.from(texto)
  const n = datos.length
  const cab = n < 126 ? Buffer.from([0x81, n]) : n < 65536 ? Buffer.from([0x81, 126, n >> 8, n & 255]) : null
  if (!cab) {
    const c = Buffer.alloc(10)
    c[0] = 0x81
    c[1] = 127
    c.writeBigUInt64BE(BigInt(n), 2)
    return Buffer.concat([c, datos])
  }
  return Buffer.concat([cab, datos])
}

export function crearComfySimulado({ sin3d = false, paso = 25 } = {}) {
  const subidas = new Map()
  const salidas = new Map()
  const historial = new Map()
  const sockets = new Map()
  const interrumpidos = new Set()

  const avisar = (clientId, type, data) => {
    const s = sockets.get(clientId)
    if (s && !s.destroyed) s.write(marco(JSON.stringify({ type, data })))
  }

  async function ejecutar(promptId, clientId, grafo) {
    avisar(clientId, 'execution_start', { prompt_id: promptId })
    const muestreador = Object.keys(grafo).find((k) => grafo[k].class_type === 'KSampler')
    const pasos = Number(grafo[muestreador]?.inputs?.steps ?? 20)
    avisar(clientId, 'executing', { node: muestreador, prompt_id: promptId })
    for (let i = 1; i <= pasos; i++) {
      await esperar(paso)
      if (interrumpidos.has(promptId)) {
        avisar(clientId, 'execution_interrupted', { prompt_id: promptId })
        historial.set(promptId, { outputs: {}, status: { status_str: 'error', completed: false, messages: [['execution_interrupted', {}]] } })
        return
      }
      avisar(clientId, 'progress', { value: i, max: pasos, prompt_id: promptId, node: muestreador })
    }
    const outputs = {}
    for (const [nodo, spec] of Object.entries(grafo)) {
      if (spec.class_type === 'SaveImage') {
        const texto = Object.values(grafo).find((v) => v.class_type === 'CLIPTextEncode')?.inputs?.text ?? ''
        const nombre = `imagen_${String(salidas.size + 1).padStart(5, '0')}_.png`
        salidas.set(nombre, { datos: png(texto), tipo: 'image/png' })
        outputs[nodo] = { images: [{ filename: nombre, subfolder: 'taller', type: 'output' }] }
      } else if (spec.class_type === 'SaveGLB') {
        avisar(clientId, 'executing', { node: '8', prompt_id: promptId })
        await esperar(paso * 4)
        avisar(clientId, 'executing', { node: '9', prompt_id: promptId })
        const origen = Object.values(grafo).find((v) => v.class_type === 'LoadImage')?.inputs?.image ?? ''
        const huella = createHash('sha1').update(subidas.get(origen) ?? origen).digest('hex')
        const nombre = `taller_${String(salidas.size + 1).padStart(5, '0')}_.glb`
        salidas.set(nombre, { datos: glb(huella), tipo: 'model/gltf-binary' })
        outputs[nodo] = { '3d': [{ filename: nombre, subfolder: '3d', type: 'output' }] }
      }
      avisar(clientId, 'executing', { node: nodo, prompt_id: promptId })
    }
    historial.set(promptId, { prompt: [], outputs, status: { status_str: 'success', completed: true, messages: [] } })
    avisar(clientId, 'execution_success', { prompt_id: promptId })
    avisar(clientId, 'executing', { node: null, prompt_id: promptId })
  }

  const servidor = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x')
    const ruta = url.pathname
    const checkpoints = ['sd_xl_base_1.0.safetensors', 'flux1-schnell-fp8.safetensors', ...(sin3d ? [] : ['hunyuan_3d_v2.1.safetensors'])]

    if (ruta === '/system_stats') {
      return json(res, 200, {
        system: { comfyui_version: '0.42.1-simulado', os: process.platform },
        devices: [{ name: 'cuda:0 NVIDIA GeForce RTX 5070 (simulada) : cudaMallocAsync', type: 'cuda', vram_total: 12 * 2 ** 30, vram_free: 11 * 2 ** 30 }]
      })
    }
    if (ruta === '/models/checkpoints') return json(res, 200, checkpoints)
    if (ruta.startsWith('/object_info/')) {
      const clase = decodeURIComponent(ruta.slice('/object_info/'.length))
      if (clase === 'CheckpointLoaderSimple') return json(res, 200, { [clase]: { input: { required: { ckpt_name: [checkpoints] } } } })
      return json(res, 200, NODOS_3D.includes(clase) && !sin3d ? { [clase]: { input: {}, output: [] } } : {})
    }
    if (ruta === '/upload/image' && req.method === 'POST') {
      const f = archivoMultipart(req, await leer(req))
      if (!f) return json(res, 400, { error: 'sin imagen' })
      subidas.set(f.nombre, f.datos)
      return json(res, 200, { name: f.nombre, subfolder: '', type: 'input' })
    }
    if (ruta === '/prompt' && req.method === 'POST') {
      const cuerpo = JSON.parse((await leer(req)).toString() || '{}')
      const grafo = cuerpo.prompt ?? {}
      for (const [nodo, spec] of Object.entries(grafo)) {
        const ck = spec.inputs?.ckpt_name
        if (ck && !checkpoints.includes(ck)) {
          return json(res, 400, {
            error: { type: 'prompt_outputs_failed_validation', message: 'Prompt outputs failed validation' },
            node_errors: { [nodo]: { errors: [{ message: `Value not in list: ckpt_name: '${ck}'` }] } }
          })
        }
      }
      const promptId = randomUUID()
      void ejecutar(promptId, cuerpo.client_id ?? '', grafo)
      return json(res, 200, { prompt_id: promptId, number: historial.size, node_errors: {} })
    }
    if (ruta.startsWith('/history/')) {
      const id = ruta.slice('/history/'.length)
      return json(res, 200, historial.has(id) ? { [id]: historial.get(id) } : {})
    }
    if (ruta === '/view') {
      const s = salidas.get(url.searchParams.get('filename'))
      if (!s) return json(res, 404, { error: 'no existe' })
      res.writeHead(200, { 'Content-Type': s.tipo })
      return res.end(s.datos)
    }
    if (ruta === '/interrupt') {
      const cuerpo = JSON.parse((await leer(req)).toString() || '{}')
      if (cuerpo.prompt_id) interrumpidos.add(cuerpo.prompt_id)
      return json(res, 200, {})
    }
    if (ruta === '/free') return json(res, 200, {})
    json(res, 404, { error: 'not found' })
  })

  servidor.on('upgrade', (req, socket) => {
    const url = new URL(req.url, 'http://x')
    if (url.pathname !== '/ws') return socket.destroy()
    const clave = req.headers['sec-websocket-key']
    const acepta = createHash('sha1').update(clave + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acepta}\r\n\r\n`)
    const id = url.searchParams.get('clientId') ?? randomUUID()
    sockets.set(id, socket)
    socket.write(marco(JSON.stringify({ type: 'status', data: { status: { exec_info: { queue_remaining: 0 } }, sid: id } })))
    socket.on('data', (d) => {
      // Marco de cierre del cliente: se responde y se cierra
      if ((d[0] & 0x0f) === 0x8) socket.end(Buffer.from([0x88, 0]))
    })
    socket.on('close', () => sockets.delete(id))
    socket.on('error', () => sockets.delete(id))
  })

  return servidor
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const i = process.argv.indexOf('--puerto')
  const puerto = Number(i >= 0 ? process.argv[i + 1] : 8188)
  crearComfySimulado({ sin3d: process.argv.includes('--sin-3d') })
    .on('error', (e) => {
      console.error(e.code === 'EADDRINUSE' ? `El puerto ${puerto} está ocupado (¿ya corre ComfyUI?). Usa --puerto.` : e.message)
      process.exit(1)
    })
    .listen(puerto, '127.0.0.1', () => console.log(`ComfyUI simulado en http://127.0.0.1:${puerto}`))
}
