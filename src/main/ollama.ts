// Cliente de la API nativa de Ollama (/api/*). Sin dependencias de Electron para poder probarlo.
import type { Capacidad, ModeloLocal } from '@shared/tipos'

export interface LlamadaHerramienta {
  function: { name: string; arguments: Record<string, unknown> }
}

export interface Mensaje {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  images?: string[]
  thinking?: string
  tool_calls?: LlamadaHerramienta[]
  tool_name?: string
  /** Rutas de las imágenes adjuntas; no se manda a Ollama, sirve para recargarlas. */
  _imagenes?: string[]
}

export interface DefinicionHerramienta {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

export interface PedidoChat {
  model: string
  messages: Mensaje[]
  tools?: DefinicionHerramienta[]
  think?: boolean
  options?: Record<string, unknown>
  format?: unknown
}

export interface RespuestaChat {
  content: string
  thinking: string
  tool_calls: LlamadaHerramienta[]
  promptTokens: number
  evalTokens: number
  doneReason?: string
}

export interface Pedazo {
  content?: string
  thinking?: string
}

export class ErrorOllama extends Error {}

const CAPACIDADES: Capacidad[] = ['completion', 'tools', 'vision', 'thinking', 'embedding', 'insert']

export class Ollama {
  private caps = new Map<string, { capacidades: Capacidad[]; contexto?: number }>()

  constructor(public url: string) {
    this.url = url.replace(/\/+$/, '')
  }

  async version(timeoutMs = 2500): Promise<string> {
    const r = await this.pedir('/api/version', { signal: AbortSignal.timeout(timeoutMs) })
    return ((await r.json()) as { version?: string }).version ?? '?'
  }

  async modelos(): Promise<ModeloLocal[]> {
    const r = await this.pedir('/api/tags', { signal: AbortSignal.timeout(8000) })
    const data = (await r.json()) as { models?: any[] }
    const lista = data.models ?? []
    return Promise.all(
      lista.map(async (m): Promise<ModeloLocal> => {
        const nombre: string = m.name ?? m.model
        const info = await this.mostrar(nombre, m.digest).catch(() => ({ capacidades: ['completion'] as Capacidad[] }))
        return {
          nombre,
          familia: m.details?.family,
          parametros: m.details?.parameter_size,
          cuantizacion: m.details?.quantization_level,
          tamano: m.size ?? 0,
          modificado: m.modified_at,
          ...info
        }
      })
    )
  }

  /** Capacidades y contexto de un modelo; se guardan por digest para no repetir la consulta. */
  async mostrar(nombre: string, digest = ''): Promise<{ capacidades: Capacidad[]; contexto?: number }> {
    const clave = `${nombre}@${digest}`
    const guardado = this.caps.get(clave)
    if (guardado) return guardado
    const r = await this.pedir('/api/show', {
      method: 'POST',
      body: JSON.stringify({ model: nombre }),
      signal: AbortSignal.timeout(8000)
    })
    const info = inferirCapacidades(await r.json(), nombre)
    this.caps.set(clave, info)
    return info
  }

  async *descargar(modelo: string, signal?: AbortSignal): AsyncGenerator<{ status: string; total?: number; completed?: number }> {
    const r = await this.pedir('/api/pull', { method: 'POST', body: JSON.stringify({ model: modelo, stream: true }), signal })
    for await (const linea of lineasJson(r, signal)) {
      if (linea.error) throw new ErrorOllama(String(linea.error))
      yield linea
    }
  }

  async borrar(modelo: string): Promise<void> {
    await this.pedir('/api/delete', { method: 'DELETE', body: JSON.stringify({ model: modelo }) })
  }

  async embeddings(modelo: string, textos: string[], signal?: AbortSignal): Promise<number[][]> {
    const r = await this.pedir('/api/embed', { method: 'POST', body: JSON.stringify({ model: modelo, input: textos }), signal })
    return ((await r.json()) as { embeddings: number[][] }).embeddings
  }

  /** Chat en streaming: avisa cada pedazo de texto o razonamiento y devuelve el mensaje completo. */
  async chat(pedido: PedidoChat, alPedazo: (p: Pedazo) => void, signal?: AbortSignal): Promise<RespuestaChat> {
    const r = await this.pedir('/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        ...pedido,
        messages: pedido.messages.map(({ _imagenes: _, ...m }) => m),
        stream: true,
        keep_alive: '15m'
      }),
      signal
    })
    const salida: RespuestaChat = { content: '', thinking: '', tool_calls: [], promptTokens: 0, evalTokens: 0 }
    for await (const linea of lineasJson(r, signal)) {
      if (linea.error) throw new ErrorOllama(traducirError(String(linea.error)))
      const m = linea.message ?? {}
      if (m.thinking) {
        salida.thinking += m.thinking
        alPedazo({ thinking: m.thinking })
      }
      if (m.content) {
        salida.content += m.content
        alPedazo({ content: m.content })
      }
      if (Array.isArray(m.tool_calls)) salida.tool_calls.push(...m.tool_calls.map(normalizarLlamada))
      if (linea.done) {
        salida.promptTokens = linea.prompt_eval_count ?? 0
        salida.evalTokens = linea.eval_count ?? 0
        salida.doneReason = linea.done_reason
      }
    }
    return salida
  }

  private async pedir(ruta: string, init: RequestInit): Promise<Response> {
    let r: Response
    try {
      r = await fetch(this.url + ruta, { ...init, headers: { 'Content-Type': 'application/json' } })
    } catch (e) {
      if ((e as Error).name === 'AbortError' || (e as Error).name === 'TimeoutError') throw e
      throw new ErrorOllama(`Ollama no responde en ${this.url}.`)
    }
    if (!r.ok) {
      const texto = await r.text().catch(() => '')
      let msg = texto
      try {
        msg = JSON.parse(texto).error ?? texto
      } catch {
        /* texto plano */
      }
      throw new ErrorOllama(traducirError(msg || `HTTP ${r.status}`))
    }
    return r
  }
}

function normalizarLlamada(c: any): LlamadaHerramienta {
  let args = c?.function?.arguments ?? {}
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args)
    } catch {
      args = { valor: args }
    }
  }
  return { function: { name: String(c?.function?.name ?? ''), arguments: args } }
}

/** Las versiones viejas de Ollama no traen `capabilities`; se deducen de la plantilla y el model_info. */
export function inferirCapacidades(info: any, nombre = ''): { capacidades: Capacidad[]; contexto?: number } {
  const modelInfo: Record<string, unknown> = info?.model_info ?? {}
  const claveCtx = Object.keys(modelInfo).find((k) => k.endsWith('.context_length'))
  const contexto = claveCtx ? Number(modelInfo[claveCtx]) || undefined : undefined
  if (Array.isArray(info?.capabilities) && info.capabilities.length) {
    const caps = info.capabilities.filter((c: string): c is Capacidad => CAPACIDADES.includes(c as Capacidad))
    return { capacidades: caps, contexto }
  }
  const caps = new Set<Capacidad>()
  const plantilla: string = info?.template ?? ''
  const familias: string[] = [info?.details?.family, ...(info?.details?.families ?? [])].filter(Boolean)
  const esEmbed = familias.some((f) => /bert|embed/i.test(f)) || /embed/i.test(nombre)
  if (esEmbed) caps.add('embedding')
  else caps.add('completion')
  if (/\.Tools\b/.test(plantilla)) caps.add('tools')
  if (info?.projector_info || Object.keys(modelInfo).some((k) => k.includes('vision'))) caps.add('vision')
  if (/\.Thinking\b|<think>/.test(plantilla)) caps.add('thinking')
  if (/\.Suffix\b/.test(plantilla)) caps.add('insert')
  return { capacidades: [...caps], contexto }
}

export function traducirError(msg: string): string {
  if (/does not support tools/i.test(msg)) return 'Este modelo no soporta herramientas. Cambia a un modelo con «Herramientas» o usa el modo Chat.'
  if (/does not support thinking/i.test(msg)) return 'Este modelo no tiene modo de razonamiento.'
  if (/does not support (images|vision)|image input/i.test(msg)) return 'Este modelo no ve imágenes.'
  if (/model .* not found|no such model/i.test(msg)) return 'Ese modelo no está instalado en Ollama.'
  if (/out of memory|cudaMalloc|insufficient memory/i.test(msg)) return 'No alcanza la memoria para cargar el modelo. Prueba uno más pequeño o baja el contexto en Ajustes.'
  return msg
}

/** Lee una respuesta NDJSON línea por línea. */
async function* lineasJson(r: Response, signal?: AbortSignal): AsyncGenerator<any> {
  if (!r.body) return
  const lector = r.body.getReader()
  const decod = new TextDecoder()
  let resto = ''
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('Detenido', 'AbortError')
      const { value, done } = await lector.read()
      if (done) break
      resto += decod.decode(value, { stream: true })
      let i: number
      while ((i = resto.indexOf('\n')) >= 0) {
        const linea = resto.slice(0, i).trim()
        resto = resto.slice(i + 1)
        if (linea) yield JSON.parse(linea)
      }
    }
    if (resto.trim()) yield JSON.parse(resto)
  } finally {
    lector.releaseLock()
  }
}
