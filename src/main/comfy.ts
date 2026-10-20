// Cliente de ComfyUI para texto→imagen e imagen→3D (Hunyuan3D 2.x), portado de Plasmo.
import { randomInt, randomUUID } from 'node:crypto'
import type { EstadoComfy } from '@shared/tipos'

export const NODOS_3D = [
  'ImageOnlyCheckpointLoader',
  'Hunyuan3Dv2Conditioning',
  'EmptyLatentHunyuan3Dv2',
  'VAEDecodeHunyuan3D',
  'VoxelToMesh',
  'SaveGLB'
]

// Ajustes de las plantillas oficiales de Comfy-Org por checkpoint
const PRESETS = {
  '2.1': { resolution: 4096, steps: 30, cfg: 5.0 },
  '2.0': { resolution: 3072, steps: 20, cfg: 8.0 },
  mini: { resolution: 512, steps: 30, cfg: 5.0 }
}

export function preset3d(checkpoint: string) {
  const n = checkpoint.toLowerCase()
  if (n.includes('mini')) return PRESETS.mini
  if (/2[._-]1/.test(n)) return PRESETS['2.1']
  return PRESETS['2.0']
}

export function es3d(checkpoint: string): boolean {
  return /hunyuan.?3d/i.test(checkpoint)
}

export interface Progreso {
  fraccion: number
  etapa: string
}

type Grafo = Record<string, { class_type: string; inputs: Record<string, unknown> }>

export function grafoImagen(prompt: string, checkpoint: string, ancho = 1024, alto = 1024, semilla?: number): Grafo {
  const negativo = 'text, watermark, signature, lowres, blurry, jpeg artifacts, deformed'
  return {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpoint } },
    '2': { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 1], text: prompt } },
    '3': { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 1], text: negativo } },
    '4': { class_type: 'EmptyLatentImage', inputs: { width: ancho, height: alto, batch_size: 1 } },
    '5': {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0],
        positive: ['2', 0],
        negative: ['3', 0],
        latent_image: ['4', 0],
        seed: semilla ?? randomInt(1, 2 ** 31 - 1),
        steps: 25,
        cfg: 6.0,
        sampler_name: 'dpmpp_2m',
        scheduler: 'karras',
        denoise: 1.0
      }
    },
    '6': { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
    '7': { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'taller/imagen' } }
  }
}

export function grafo3d(imagen: string, checkpoint: string, semilla?: number): Grafo {
  const p = preset3d(checkpoint)
  return {
    '1': { class_type: 'ImageOnlyCheckpointLoader', inputs: { ckpt_name: checkpoint } },
    '2': { class_type: 'LoadImage', inputs: { image: imagen } },
    '3': { class_type: 'CLIPVisionEncode', inputs: { clip_vision: ['1', 1], image: ['2', 0], crop: 'center' } },
    '4': { class_type: 'Hunyuan3Dv2Conditioning', inputs: { clip_vision_output: ['3', 0] } },
    '5': { class_type: 'ModelSamplingAuraFlow', inputs: { model: ['1', 0], shift: 1.0 } },
    '6': { class_type: 'EmptyLatentHunyuan3Dv2', inputs: { resolution: p.resolution, batch_size: 1 } },
    '7': {
      class_type: 'KSampler',
      inputs: {
        model: ['5', 0],
        positive: ['4', 0],
        negative: ['4', 1],
        latent_image: ['6', 0],
        seed: semilla ?? randomInt(1, 2 ** 31 - 1),
        steps: p.steps,
        cfg: p.cfg,
        sampler_name: 'euler',
        scheduler: 'normal',
        denoise: 1.0
      }
    },
    '8': {
      class_type: 'VAEDecodeHunyuan3D',
      inputs: { samples: ['7', 0], vae: ['1', 2], num_chunks: 8000, octree_resolution: 256 }
    },
    '9': { class_type: 'VoxelToMesh', inputs: { voxel: ['8', 0], algorithm: 'surface net', threshold: 0.6 } },
    '10': { class_type: 'SaveGLB', inputs: { mesh: ['9', 0], filename_prefix: '3d/taller' } }
  }
}

export class ErrorComfy extends Error {}

export class Comfy {
  constructor(public url: string) {
    this.url = url.replace(/\/+$/, '')
  }

  async estado(): Promise<EstadoComfy> {
    const base: EstadoComfy = {
      conectado: false,
      url: this.url,
      checkpointsImagen: [],
      checkpoints3d: [],
      nodos3d: false,
      faltan: [],
      mensaje: ''
    }
    let stats: any
    try {
      stats = await this.json('/system_stats', undefined, 2500)
    } catch {
      return { ...base, mensaje: `ComfyUI no responde en ${this.url}.` }
    }
    const checkpoints = await this.checkpoints()
    const faltan: string[] = []
    for (const n of NODOS_3D) {
      const info = await this.json(`/object_info/${n}`).catch(() => ({}))
      if (!info || !info[n]) faltan.push(n)
    }
    const dev = stats?.devices?.[0] ?? {}
    const estado: EstadoComfy = {
      ...base,
      conectado: true,
      version: stats?.system?.comfyui_version,
      gpu: dev.name ? String(dev.name).replace(/^cuda:\d+\s*/, '').replace(/\s*:\s*cudaMallocAsync$/, '') : undefined,
      vramGb: dev.vram_total ? Math.round((dev.vram_total / 2 ** 30) * 10) / 10 : undefined,
      checkpoints3d: checkpoints.filter(es3d),
      checkpointsImagen: checkpoints.filter((c) => !es3d(c)),
      nodos3d: faltan.length === 0,
      faltan
    }
    estado.mensaje = `ComfyUI ${estado.version ?? ''} · ${estado.gpu ?? 'sin GPU'}`.trim()
    return estado
  }

  private async checkpoints(): Promise<string[]> {
    try {
      const lista = await this.json('/models/checkpoints')
      if (Array.isArray(lista)) return lista
    } catch {
      /* versiones viejas: se lee del nodo */
    }
    const info = await this.json('/object_info/CheckpointLoaderSimple').catch(() => ({}))
    const opciones = info?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0]
    return Array.isArray(opciones) ? opciones : []
  }

  async textoAImagen(
    o: { prompt: string; checkpoint: string; ancho?: number; alto?: number },
    alProgreso: (p: Progreso) => void,
    signal?: AbortSignal
  ): Promise<Buffer> {
    const grafo = grafoImagen(o.prompt, o.checkpoint, o.ancho, o.alto)
    const salidas = await this.correr(grafo, '5', { '6': [0.93, 'Decodificando la imagen…'] }, alProgreso, signal)
    const ref = salidas['7']?.images?.[0]
    if (!ref) throw new ErrorComfy('ComfyUI no devolvió la imagen.')
    const datos = await this.ver(ref)
    void this.liberar()
    return datos
  }

  async imagenA3d(
    o: { imagen: Buffer; checkpoint: string },
    alProgreso: (p: Progreso) => void,
    signal?: AbortSignal
  ): Promise<Buffer> {
    alProgreso({ fraccion: 0.02, etapa: 'Subiendo la imagen…' })
    const nombre = await this.subir(o.imagen, `taller-${randomUUID().slice(0, 8)}.png`)
    alProgreso({ fraccion: 0.04, etapa: 'Cargando Hunyuan3D en la GPU…' })
    const etapas: Record<string, [number, string]> = {
      '8': [0.8, 'Decodificando el volumen…'],
      '9': [0.9, 'Extrayendo la superficie…'],
      '10': [0.97, 'Guardando el GLB…']
    }
    const salidas = await this.correr(grafo3d(nombre, o.checkpoint), '7', etapas, alProgreso, signal)
    const ref = salidas['10']?.['3d']?.[0]
    if (!ref) throw new ErrorComfy('ComfyUI terminó pero no guardó el GLB.')
    const glb = await this.ver(ref)
    void this.liberar()
    return glb
  }

  async liberar(): Promise<void> {
    await fetch(this.url + '/free', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unload_models: true, free_memory: true })
    }).catch(() => undefined)
  }

  private async subir(datos: Buffer, nombre: string): Promise<string> {
    const form = new FormData()
    form.append('image', new Blob([new Uint8Array(datos)], { type: 'image/png' }), nombre)
    form.append('overwrite', 'true')
    const r = await fetch(this.url + '/upload/image', { method: 'POST', body: form })
    if (!r.ok) throw new ErrorComfy(`ComfyUI no aceptó la imagen (HTTP ${r.status}).`)
    const up = (await r.json()) as { name: string; subfolder?: string }
    return up.subfolder ? `${up.subfolder}/${up.name}` : up.name
  }

  /** Encola el grafo, sigue el progreso (WebSocket si hay, si no consulta /history) y devuelve las salidas. */
  private async correr(
    grafo: Grafo,
    muestreador: string,
    etapas: Record<string, [number, string]>,
    alProgreso: (p: Progreso) => void,
    signal?: AbortSignal
  ): Promise<Record<string, any>> {
    const clientId = randomUUID()
    const ws = await this.abrirSocket(clientId)
    let promptId = ''
    // Se escucha antes de encolar para no perder mensajes de un flujo rápido
    const seguimiento = ws ? this.escuchar(ws, () => promptId, muestreador, etapas, alProgreso, signal) : null
    seguimiento?.catch(() => undefined)
    try {
      const r = await fetch(this.url + '/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: grafo, client_id: clientId })
      })
      const cuerpo = (await r.json().catch(() => ({}))) as any
      if (!r.ok) {
        const detalle = cuerpo?.error?.message ?? JSON.stringify(cuerpo?.node_errors ?? cuerpo).slice(0, 300)
        throw new ErrorComfy(`ComfyUI rechazó el flujo: ${detalle}`)
      }
      promptId = cuerpo.prompt_id
      const alAbortar = () => void this.interrumpir(promptId)
      signal?.addEventListener('abort', alAbortar, { once: true })
      try {
        if (seguimiento) await seguimiento
        return await this.esperarHistorial(promptId, alProgreso, signal)
      } finally {
        signal?.removeEventListener('abort', alAbortar)
      }
    } finally {
      ws?.close()
    }
  }

  private async abrirSocket(clientId: string): Promise<WebSocket | null> {
    const WS = (globalThis as any).WebSocket as typeof WebSocket | undefined
    if (!WS) return null
    const u = new URL(this.url)
    const ws = new WS(`${u.protocol === 'https:' ? 'wss' : 'ws'}://${u.host}/ws?clientId=${clientId}`)
    return new Promise((ok) => {
      const t = setTimeout(() => {
        ws.close()
        ok(null)
      }, 3000)
      ws.onopen = () => {
        clearTimeout(t)
        ok(ws)
      }
      ws.onerror = () => {
        clearTimeout(t)
        ok(null)
      }
    })
  }

  private escuchar(
    ws: WebSocket,
    promptId: () => string,
    muestreador: string,
    etapas: Record<string, [number, string]>,
    alProgreso: (p: Progreso) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const [desde, hasta] = [0.05, 0.78]
    let vigia: ReturnType<typeof setInterval> | undefined
    return new Promise<void>((ok, mal) => {
      // Por si el socket se pierde el final: cada 5 s se mira el historial
      vigia = setInterval(async () => {
        if (!promptId()) return
        const h = await this.json(`/history/${promptId()}`).catch(() => ({}))
        if (h?.[promptId()]) ok()
      }, 5000)
      signal?.addEventListener('abort', () => mal(new DOMException('Detenido', 'AbortError')), { once: true })
      ws.onclose = () => ok()
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return
        const msg = JSON.parse(ev.data)
        const d = msg.data ?? {}
        if (promptId() && d.prompt_id && d.prompt_id !== promptId()) return
        if (msg.type === 'progress' && String(d.node) === muestreador && d.max) {
          alProgreso({ fraccion: desde + (hasta - desde) * (d.value / d.max), etapa: `Muestreando ${d.value}/${d.max}` })
        } else if (msg.type === 'executing') {
          if (d.node == null) return ok()
          const e = etapas[String(d.node)]
          if (e) alProgreso({ fraccion: e[0], etapa: e[1] })
        } else if (msg.type === 'execution_error') {
          mal(new ErrorComfy(`ComfyUI falló en ${d.node_type}: ${String(d.exception_message ?? '').trim()}`))
        } else if (msg.type === 'execution_interrupted') {
          mal(new DOMException('Detenido', 'AbortError'))
        } else if (msg.type === 'execution_success') {
          ok()
        }
      }
    }).finally(() => clearInterval(vigia))
  }

  private async esperarHistorial(promptId: string, alProgreso: (p: Progreso) => void, signal?: AbortSignal) {
    const inicio = Date.now()
    while (Date.now() - inicio < 30 * 60_000) {
      if (signal?.aborted) throw new DOMException('Detenido', 'AbortError')
      const h = await this.json(`/history/${promptId}`).catch(() => ({}))
      const entrada = h?.[promptId]
      if (entrada) {
        if (entrada.status?.status_str === 'error') {
          const m = (entrada.status.messages ?? []).find((x: any) => x?.[0] === 'execution_error')
          throw new ErrorComfy(`ComfyUI falló: ${String(m?.[1]?.exception_message ?? '').trim()}`)
        }
        return entrada.outputs ?? {}
      }
      // Sin WebSocket la barra se estima por tiempo
      alProgreso({ fraccion: Math.min(0.9, 0.05 + (Date.now() - inicio) / 240_000), etapa: 'Trabajando en ComfyUI…' })
      await new Promise((r) => setTimeout(r, 800))
    }
    throw new ErrorComfy('ComfyUI tardó demasiado.')
  }

  private async interrumpir(promptId: string) {
    await fetch(this.url + '/interrupt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt_id: promptId })
    }).catch(() => undefined)
  }

  private async ver(ref: { filename: string; subfolder?: string; type?: string }): Promise<Buffer> {
    const q = new URLSearchParams({ filename: ref.filename, subfolder: ref.subfolder ?? '', type: ref.type ?? 'output' })
    const r = await fetch(`${this.url}/view?${q}`)
    if (!r.ok) throw new ErrorComfy(`No se pudo bajar ${ref.filename} de ComfyUI.`)
    return Buffer.from(await r.arrayBuffer())
  }

  private async json(ruta: string, init?: RequestInit, timeoutMs = 8000): Promise<any> {
    const r = await fetch(this.url + ruta, { ...init, signal: AbortSignal.timeout(timeoutMs) })
    if (!r.ok) throw new ErrorComfy(`HTTP ${r.status}`)
    return r.json()
  }
}
