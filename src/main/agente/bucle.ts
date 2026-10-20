import { nuevoId } from '@shared/conversacion'
import type { Capacidad, Evento, ModoPermiso, RespuestaPermiso } from '@shared/tipos'
import type { LlamadaHerramienta, Mensaje, Ollama } from '../ollama'
import { compactar, debeCompactar } from './compactar'
import { definicion, recortar } from './herramientas'
import { extraerLlamadas, separarPensamiento } from './llamadas'
import { requierePermiso } from './permisos'
import type { CtxHerramienta, Herramienta } from './tipos'

export interface SolicitudPermiso {
  id: string
  herramientaId: string
  nombre: string
  resumen: string
  detalle?: string
}

export interface OpcionesAgente {
  ollama: Ollama
  modelo: string
  capacidades: Capacidad[]
  sistema: string
  /** Se modifica en el lugar: queda con todo lo hablado. */
  historial: Mensaje[]
  /** Vacío = chat sin herramientas. */
  herramientas: Herramienta[]
  modoPermiso: ModoPermiso
  pensar: boolean
  contexto: number
  maxPasos: number
  signal: AbortSignal
  permitidas: Set<string>
  ctx: Omit<CtxHerramienta, 'progreso'>
  emitir(e: Evento): void
  pedirPermiso(s: SolicitudPermiso): Promise<RespuestaPermiso>
  /** Se llama cuando el historial se compacta (para guardarlo). */
  alCompactar?(historial: Mensaje[]): void
}

const DETENIDO = () => new DOMException('Detenido', 'AbortError')

/** Corre turnos modelo → herramientas hasta que el modelo responde sin pedir nada más. Devuelve el último texto. */
export async function correrAgente(o: OpcionesAgente): Promise<string> {
  let ultimo = ''
  let tokensPrompt = 0
  const nombres = o.herramientas.map((h) => h.nombre)
  const definiciones = o.herramientas.map(definicion)
  const piensa = o.capacidades.includes('thinking')
  // Lo que cabe de un resultado de herramienta: ~40 % del contexto (≈ 4 caracteres por token)
  const maxResultado = Math.max(4000, Math.floor(o.contexto * 4 * 0.4))

  for (let paso = 0; paso < o.maxPasos; paso++) {
    if (o.signal.aborted) throw DETENIDO()
    if (debeCompactar(tokensPrompt, o.contexto)) {
      const aviso = nuevoId('a')
      o.emitir({ tipo: 'item', item: { id: aviso, tipo: 'aviso', texto: 'Compactando la conversación para liberar contexto…', nivel: 'info', ts: Date.now() } })
      const nuevo = await compactar(o.ollama, o.modelo, o.historial, o.contexto, o.signal)
      o.historial.splice(0, o.historial.length, ...nuevo)
      o.alCompactar?.(o.historial)
      o.emitir({ tipo: 'actualizar', itemId: aviso, cambios: { texto: 'Conversación compactada: lo anterior quedó resumido.' } })
      tokensPrompt = 0
    }

    const itemId = nuevoId('m')
    o.emitir({ tipo: 'item', item: { id: itemId, tipo: 'asistente', texto: '', modelo: o.modelo, ts: Date.now() } })
    const r = await o.ollama.chat(
      {
        model: o.modelo,
        messages: [{ role: 'system', content: o.sistema }, ...o.historial],
        tools: definiciones.length ? definiciones : undefined,
        think: piensa ? o.pensar : undefined,
        options: { num_ctx: o.contexto }
      },
      (p) => {
        if (p.thinking) o.emitir({ tipo: 'pensamiento', itemId, delta: p.thinking })
        if (p.content) o.emitir({ tipo: 'texto', itemId, delta: p.content })
      },
      o.signal
    )

    let { texto, pensamiento } = separarPensamiento(r.content)
    let llamadas: LlamadaHerramienta[] = r.tool_calls
    if (!llamadas.length && nombres.length) {
      const rescate = extraerLlamadas(texto, nombres)
      if (rescate.llamadas.length) {
        llamadas = rescate.llamadas
        texto = rescate.resto
      }
    }
    pensamiento = [r.thinking, pensamiento].filter(Boolean).join('\n').trim()
    if (texto !== r.content || pensamiento !== (r.thinking ?? '')) {
      o.emitir({ tipo: 'actualizar', itemId, cambios: { texto, pensamiento: pensamiento || undefined } })
    }
    if (!texto && !pensamiento) o.emitir({ tipo: 'quitar', itemId })

    o.historial.push({ role: 'assistant', content: texto, ...(llamadas.length ? { tool_calls: llamadas } : {}) })
    tokensPrompt = r.promptTokens + r.evalTokens
    o.emitir({ tipo: 'uso', prompt: tokensPrompt, contexto: o.contexto })
    if (texto) ultimo = texto
    if (!llamadas.length) return ultimo

    for (const llamada of llamadas) {
      const res = await ejecutar(llamada, o, maxResultado)
      o.historial.push({ role: 'tool', tool_name: llamada.function.name, content: res.texto })
      if (res.detener) return ultimo
    }
  }

  o.emitir({
    tipo: 'item',
    item: {
      id: nuevoId('a'),
      tipo: 'aviso',
      texto: `Paré al llegar a ${o.maxPasos} pasos. Escribe «sigue» para continuar.`,
      nivel: 'info',
      ts: Date.now()
    }
  })
  return ultimo
}

async function ejecutar(llamada: LlamadaHerramienta, o: OpcionesAgente, maxResultado: number): Promise<{ texto: string; detener?: boolean }> {
  const nombre = llamada.function.name
  const args = (llamada.function.arguments ?? {}) as Record<string, any>
  const h = o.herramientas.find((x) => x.nombre === nombre)
  const id = nuevoId('h')

  if (!h) {
    const texto = `La herramienta «${nombre}» no existe aquí. Usa una de: ${o.herramientas.map((x) => x.nombre).join(', ')}.`
    o.emitir({
      tipo: 'item',
      item: { id, tipo: 'herramienta', nombre, resumen: nombre, args, estado: 'error', resultado: texto, ts: Date.now() }
    })
    return { texto }
  }

  const resumen = seguro(() => h.resumen(args), nombre)
  o.emitir({ tipo: 'item', item: { id, tipo: 'herramienta', nombre, resumen, args, estado: 'corriendo', ts: Date.now() } })
  const ctx: CtxHerramienta = {
    ...o.ctx,
    progreso: (etapa) => o.emitir({ tipo: 'actualizar', itemId: id, cambios: { resultado: etapa } })
  }

  if (requierePermiso(h, args, o.modoPermiso, o.ctx.carpeta, o.permitidas)) {
    o.emitir({ tipo: 'actualizar', itemId: id, cambios: { estado: 'esperando' } })
    const detalle = await h.detalle?.(args, ctx).catch(() => undefined)
    const permisoId = nuevoId('p')
    o.emitir({
      tipo: 'item',
      item: { id: permisoId, tipo: 'permiso', herramientaId: id, nombre, resumen, detalle, ts: Date.now() }
    })
    const respuesta = await o.pedirPermiso({ id: permisoId, herramientaId: id, nombre, resumen, detalle })
    o.emitir({ tipo: 'quitar', itemId: permisoId })
    if (respuesta === 'no' || o.signal.aborted) {
      o.emitir({ tipo: 'actualizar', itemId: id, cambios: { estado: 'rechazada' } })
      if (o.signal.aborted) throw DETENIDO()
      return { texto: 'El usuario rechazó esta acción. No la repitas; espera a que diga cómo seguir.', detener: true }
    }
    if (respuesta === 'siempre') o.permitidas.add(h.nombre)
    o.emitir({ tipo: 'actualizar', itemId: id, cambios: { estado: 'corriendo' } })
  }

  try {
    const res = await h.ejecutar(args, ctx)
    o.emitir({
      tipo: 'actualizar',
      itemId: id,
      cambios: { estado: res.error ? 'error' : 'ok', resultado: recortar(res.texto, 6000), archivos: res.archivos }
    })
    return { texto: recortar(res.texto, maxResultado) }
  } catch (e) {
    if ((e as Error).name === 'AbortError' || o.signal.aborted) {
      o.emitir({ tipo: 'actualizar', itemId: id, cambios: { estado: 'error', resultado: 'Detenido.' } })
      throw DETENIDO()
    }
    const msg = (e as NodeJS.ErrnoException).code === 'ENOENT' ? `No existe: ${args.path ?? args.image_path ?? ''}` : (e as Error).message
    o.emitir({ tipo: 'actualizar', itemId: id, cambios: { estado: 'error', resultado: msg } })
    return { texto: `Error: ${msg}` }
  }
}

function seguro(f: () => string, porDefecto: string): string {
  try {
    return f()
  } catch {
    return porDefecto
  }
}
