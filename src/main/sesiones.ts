// Una sesión por conversación: guarda el historial para el modelo y corre cada modo.
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { aplicar, nuevoId, tituloDesde } from '@shared/conversacion'
import { disponibilidad, FUNCION_DE_MODO, modelosEmbeddings, modoPosible, modeloInicial } from '@shared/funciones'
import type { CambiosConversacion } from '@shared/api'
import type {
  Ajustes,
  Archivo,
  Conversacion,
  Entorno,
  Envio,
  Evento,
  Modo,
  ModeloLocal,
  RespuestaPermiso,
  ResumenConversacion
} from '@shared/tipos'
import { correrAgente } from './agente/bucle'
import { busquedaSemantica, generar3d, generarImagen, HERRAMIENTAS_BASE, SUFIJO_3D } from './agente/herramientas'
import { permitidaEnModo } from './agente/permisos'
import { memoriaDelProyecto, PROMPT_SUBAGENTE, promptDeSistema } from './agente/sistema'
import type { CtxHerramienta, Herramienta } from './agente/tipos'
import type { Almacen } from './almacen'
import type { Comfy } from './comfy'
import type { GestorMcp } from './mcp'
import type { Mensaje, Ollama } from './ollama'

export interface Dependencias {
  almacen: Almacen
  ajustes(): Ajustes
  ollama(): Ollama
  comfy(): Comfy
  entorno(): Promise<Entorno>
  mcp: GestorMcp
  dirAdjuntos: string
  enviar(id: string, e: Evento): void
}

interface Sesion {
  conv: Conversacion
  historial: Mensaje[]
  abort?: AbortController
  permitidas: Set<string>
  reloj?: ReturnType<typeof setTimeout>
}

export class GestorSesiones {
  private sesiones = new Map<string, Sesion>()
  private permisos = new Map<string, { sesion: string; resolver: (r: RespuestaPermiso) => void }>()

  constructor(private d: Dependencias) {}

  listar(): Promise<ResumenConversacion[]> {
    return this.d.almacen.listar()
  }

  async abrir(id: string): Promise<Conversacion> {
    return (await this.cargar(id)).conv
  }

  async nueva(o: { modelo?: string; carpeta?: string; modo?: Modo }): Promise<Conversacion> {
    const entorno = await this.d.entorno()
    const ajustes = this.d.ajustes()
    const modelo = o.modelo ?? modeloInicial(entorno, ajustes.modeloPorDefecto)
    const info = entorno.ollama.modelos.find((m) => m.nombre === modelo)
    const ahora = Date.now()
    const conv: Conversacion = {
      id: nuevoId('c'),
      titulo: 'Conversación nueva',
      creada: ahora,
      actualizada: ahora,
      modelo,
      carpeta: o.carpeta,
      modo: modoPosible(o.modo ?? 'agente', info, entorno),
      permisos: ajustes.permisos,
      items: [],
      tareas: [],
      ocupada: false
    }
    this.sesiones.set(conv.id, { conv, historial: [], permitidas: new Set() })
    await this.guardarYa(conv.id)
    return conv
  }

  async actualizar(id: string, c: CambiosConversacion): Promise<Conversacion> {
    const s = await this.cargar(id)
    const { carpeta, ...resto } = c
    s.conv = { ...s.conv, ...resto, ...(carpeta !== undefined ? { carpeta: carpeta ?? undefined } : {}) }
    if (carpeta !== undefined) s.permitidas.clear()
    await this.guardarYa(id)
    return s.conv
  }

  async borrar(id: string): Promise<void> {
    this.detener(id)
    this.sesiones.delete(id)
    await this.d.almacen.borrar(id)
  }

  detener(id: string): void {
    const s = this.sesiones.get(id)
    s?.abort?.abort()
    for (const [pid, p] of this.permisos) {
      if (p.sesion === id) {
        p.resolver('no')
        this.permisos.delete(pid)
      }
    }
  }

  responderPermiso(permisoId: string, r: RespuestaPermiso): void {
    const p = this.permisos.get(permisoId)
    if (!p) return
    this.permisos.delete(permisoId)
    p.resolver(r)
  }

  async enviar(id: string, envio: Envio): Promise<void> {
    const s = await this.cargar(id)
    if (s.conv.ocupada) throw new Error('La conversación todavía está trabajando.')
    const emitir = (e: Evento) => {
      s.conv = aplicar(s.conv, e)
      this.d.enviar(id, e)
      this.programarGuardado(id)
    }
    const aviso = (texto: string, nivel: 'info' | 'error' = 'error') =>
      emitir({ tipo: 'item', item: { id: nuevoId('a'), tipo: 'aviso', texto, nivel, ts: Date.now() } })

    s.abort = new AbortController()
    emitir({ tipo: 'ocupada', ocupada: true })
    try {
      const entorno = await this.d.entorno()
      const modelo = entorno.ollama.modelos.find((m) => m.nombre === s.conv.modelo)
      const rutas = await this.guardarAdjuntos(envio.imagenes ?? [])

      emitir({
        tipo: 'item',
        item: { id: nuevoId('u'), tipo: 'usuario', texto: envio.texto, imagenes: rutas.length ? rutas : undefined, modo: envio.modo, ts: Date.now() }
      })
      if (s.conv.titulo === 'Conversación nueva') emitir({ tipo: 'titulo', titulo: tituloDesde(envio.texto) })
      if (s.conv.modo !== envio.modo) s.conv = { ...s.conv, modo: envio.modo }

      // La interfaz ya bloquea lo que el modelo no puede hacer; aquí se vuelve a comprobar
      const disp = disponibilidad(FUNCION_DE_MODO[envio.modo], modelo, entorno)
      if (!disp.activa) return aviso(disp.motivo ?? 'Esta función no está disponible.')
      if (rutas.length && (envio.modo === 'chat' || envio.modo === 'agente') && !disponibilidad('vision', modelo, entorno).activa) {
        return aviso(`${modelo?.nombre} no ve imágenes: quita la imagen o cambia a un modelo con Visión.`)
      }

      if (envio.modo === 'imagen') await this.imagen(s, envio, modelo, entorno, emitir)
      else if (envio.modo === 'modelo3d') await this.modelo3d(s, envio, rutas, modelo, entorno, emitir)
      else await this.conversar(s, envio, rutas, modelo!, entorno, emitir)
    } catch (e) {
      if ((e as Error).name === 'AbortError' || s.abort?.signal.aborted) aviso('Detenido.', 'info')
      else aviso((e as Error).message || String(e))
    } finally {
      s.abort = undefined
      emitir({ tipo: 'ocupada', ocupada: false })
      await this.guardarYa(id)
    }
  }

  // ---------------------------------------------------------------- chat y agente

  private async conversar(s: Sesion, envio: Envio, rutas: string[], modelo: ModeloLocal, entorno: Entorno, emitir: (e: Evento) => void) {
    const ajustes = this.d.ajustes()
    const conHerramientas = envio.modo === 'agente'
    const carpeta = s.conv.carpeta ?? ajustes.carpetaSalidas
    await mkdir(carpeta, { recursive: true })
    const herramientas = conHerramientas ? await this.herramientasPara(s, entorno, ajustes) : []
    const contexto = Math.min(ajustes.contexto, modelo.contexto ?? ajustes.contexto)
    const memoria = conHerramientas ? await memoriaDelProyecto(carpeta) : null
    const sistema = promptDeSistema({
      modelo: modelo.nombre,
      carpeta,
      conHerramientas,
      modoPermiso: s.conv.permisos,
      herramientas: herramientas.map((h) => h.nombre),
      memoria
    })

    const imagenes = await Promise.all(rutas.map((r) => readFile(r).then((b) => b.toString('base64'))))
    s.historial.push({
      role: 'user',
      content: envio.texto,
      ...(imagenes.length ? { images: imagenes, _imagenes: rutas } : {})
    })

    const signal = s.abort!.signal
    const ollama = this.d.ollama()
    const comun = { ollama, modelo: modelo.nombre, capacidades: modelo.capacidades, contexto, signal }
    const ctx: Omit<CtxHerramienta, 'progreso'> = {
      carpeta,
      salidas: join(carpeta, 'taller-salidas'),
      signal,
      ollama,
      modelo: modelo.nombre,
      ajustes,
      comfy: this.d.comfy(),
      estadoComfy: entorno.comfy,
      ponerTareas: (tareas) => emitir({ tipo: 'tareas', tareas }),
      // El subagente mira con herramientas de lectura y un contexto limpio; no pinta nada en la conversación
      subagente: (prompt) =>
        correrAgente({
          ...comun,
          ctx,
          sistema: `${PROMPT_SUBAGENTE}\n\nCarpeta de trabajo: ${carpeta}`,
          historial: [{ role: 'user', content: prompt }],
          herramientas: herramientas.filter((h) => h.clase === 'lectura'),
          modoPermiso: 'plan',
          pensar: false,
          maxPasos: 15,
          permitidas: new Set(),
          emitir: () => undefined,
          pedirPermiso: async () => 'no'
        })
    }
    await correrAgente({
      ...comun,
      ctx,
      sistema,
      historial: s.historial,
      herramientas,
      modoPermiso: s.conv.permisos,
      pensar: envio.pensar,
      maxPasos: ajustes.maxPasos,
      permitidas: s.permitidas,
      emitir,
      pedirPermiso: (sol) =>
        new Promise<RespuestaPermiso>((resolver) => this.permisos.set(sol.id, { sesion: s.conv.id, resolver })),
      alCompactar: () => this.programarGuardado(s.conv.id)
    })
  }

  private async herramientasPara(s: Sesion, entorno: Entorno, ajustes: Ajustes): Promise<Herramienta[]> {
    const lista: Herramienta[] = [...HERRAMIENTAS_BASE]
    const embeddings = modelosEmbeddings(entorno).map((m) => m.nombre)
    if (embeddings.length) {
      lista.push(busquedaSemantica(embeddings.includes(ajustes.modeloEmbeddings ?? '') ? ajustes.modeloEmbeddings! : embeddings[0]))
    }
    const c = entorno.comfy
    const ckptImagen = elegir(c.checkpointsImagen, ajustes.checkpointImagen)
    const ckpt3d = elegir(c.checkpoints3d, ajustes.checkpoint3d)
    if (c.conectado && ckptImagen) lista.push(generarImagen(ckptImagen))
    if (c.conectado && c.nodos3d && ckpt3d) lista.push(generar3d(ckpt3d, ckptImagen))
    await this.d.mcp.conectar(ajustes.mcpServers).catch(() => undefined)
    lista.push(...this.d.mcp.herramientas())
    return lista.filter((h) => permitidaEnModo(h, s.conv.permisos))
  }

  // ---------------------------------------------------------------- imagen y 3D

  private async imagen(s: Sesion, envio: Envio, modelo: ModeloLocal | undefined, entorno: Entorno, emitir: (e: Evento) => void) {
    const ajustes = this.d.ajustes()
    const checkpoint = elegir(entorno.comfy.checkpointsImagen, ajustes.checkpointImagen)!
    const id = nuevoId('g')
    emitir({
      tipo: 'item',
      item: { id, tipo: 'generacion', clase: 'imagen', prompt: envio.texto, estado: 'corriendo', progreso: 0, etapa: 'Preparando…', archivos: [], ts: Date.now() }
    })
    const signal = s.abort!.signal
    try {
      const promptFinal = await this.prompt(envio.texto, 'imagen', modelo, id, emitir, signal)
      const png = await this.d.comfy().textoAImagen({ prompt: promptFinal, checkpoint }, (p) =>
        emitir({ tipo: 'actualizar', itemId: id, cambios: { progreso: p.fraccion, etapa: p.etapa } }), signal)
      const ruta = await this.guardarSalida(s, `imagen-${sello()}.png`, png)
      emitir({ tipo: 'actualizar', itemId: id, cambios: { estado: 'ok', progreso: 1, etapa: undefined, archivos: [{ ruta, tipo: 'imagen' }] } })
      s.historial.push(
        { role: 'user', content: `[Pedí una imagen] ${envio.texto}` },
        { role: 'assistant', content: `Generé la imagen ${ruta} con el prompt: ${promptFinal}` }
      )
    } catch (e) {
      emitir({ tipo: 'actualizar', itemId: id, cambios: { estado: 'error', error: (e as Error).message, etapa: undefined } })
      if ((e as Error).name === 'AbortError') throw e
    }
  }

  private async modelo3d(s: Sesion, envio: Envio, rutas: string[], modelo: ModeloLocal | undefined, entorno: Entorno, emitir: (e: Evento) => void) {
    const ajustes = this.d.ajustes()
    const c = entorno.comfy
    const ckpt3d = elegir(c.checkpoints3d, ajustes.checkpoint3d)!
    const ckptImagen = elegir(c.checkpointsImagen, ajustes.checkpointImagen)
    const id = nuevoId('g')
    emitir({
      tipo: 'item',
      item: { id, tipo: 'generacion', clase: 'modelo3d', prompt: envio.texto, estado: 'corriendo', progreso: 0, etapa: 'Preparando…', archivos: [], ts: Date.now() }
    })
    const signal = s.abort!.signal
    const progreso = (desde: number, hasta: number) => (p: { fraccion: number; etapa: string }) =>
      emitir({ tipo: 'actualizar', itemId: id, cambios: { progreso: desde + (hasta - desde) * p.fraccion, etapa: p.etapa } })
    try {
      const archivos: Archivo[] = []
      let imagen: Buffer
      let tramo3d = progreso(0, 1)
      if (rutas.length) {
        imagen = await readFile(rutas[0])
      } else if (ckptImagen) {
        const promptFinal = await this.prompt(envio.texto, 'modelo3d', modelo, id, emitir, signal)
        imagen = await this.d.comfy().textoAImagen({ prompt: promptFinal + SUFIJO_3D, checkpoint: ckptImagen }, progreso(0, 0.35), signal)
        const ruta = await this.guardarSalida(s, `referencia-${sello()}.png`, imagen)
        archivos.push({ ruta, tipo: 'imagen' })
        emitir({ tipo: 'actualizar', itemId: id, cambios: { archivos: [...archivos] } })
        tramo3d = progreso(0.35, 1)
      } else {
        throw new Error('Adjunta una imagen del objeto, o instala un checkpoint de imagen en ComfyUI para crear el 3D desde texto.')
      }
      const glb = await this.d.comfy().imagenA3d({ imagen, checkpoint: ckpt3d }, tramo3d, signal)
      const ruta = await this.guardarSalida(s, `modelo-${sello()}.glb`, glb)
      archivos.push({ ruta, tipo: 'modelo3d' })
      emitir({ tipo: 'actualizar', itemId: id, cambios: { estado: 'ok', progreso: 1, etapa: undefined, archivos } })
      s.historial.push(
        { role: 'user', content: `[Pedí un modelo 3D] ${envio.texto}` },
        { role: 'assistant', content: `Generé el modelo 3D ${ruta}.` }
      )
    } catch (e) {
      emitir({ tipo: 'actualizar', itemId: id, cambios: { estado: 'error', error: (e as Error).message, etapa: undefined } })
      if ((e as Error).name === 'AbortError') throw e
    }
  }

  /** El modelo de chat convierte la idea en un prompt en inglés, si se puede y está activado. */
  private async prompt(idea: string, para: 'imagen' | 'modelo3d', modelo: ModeloLocal | undefined, itemId: string, emitir: (e: Evento) => void, signal: AbortSignal): Promise<string> {
    if (!this.d.ajustes().mejorarPrompt || !modelo?.capacidades.includes('completion')) return idea
    emitir({ tipo: 'actualizar', itemId, cambios: { etapa: `${modelo.nombre} escribe el prompt…` } })
    const extra =
      para === 'modelo3d'
        ? ' The picture will be turned into a 3D model: describe ONE object, whole and centered, on a plain white background, 3/4 view.'
        : ''
    try {
      const r = await this.d.ollama().chat(
        {
          model: modelo.nombre,
          messages: [
            {
              role: 'system',
              content: `You write prompts for an image diffusion model (SDXL / Flux). Turn the user's idea into ONE English paragraph of at most 70 words: subject, style, lighting, composition and colors.${extra} Reply with the prompt only: no quotes, no explanations.`
            },
            { role: 'user', content: idea }
          ],
          think: modelo.capacidades.includes('thinking') ? false : undefined,
          options: { temperature: 0.7, num_ctx: 4096 }
        },
        () => undefined,
        signal
      )
      const limpio = r.content.replace(/<think>[\s\S]*?<\/think>/g, '').trim().replace(/^["'“]|["'”]$/g, '')
      if (!limpio) return idea
      emitir({ tipo: 'actualizar', itemId, cambios: { promptFinal: limpio } })
      return limpio
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e
      return idea
    }
  }

  private async guardarSalida(s: Sesion, nombre: string, datos: Buffer): Promise<string> {
    const dir = join(s.conv.carpeta ?? this.d.ajustes().carpetaSalidas, 'taller-salidas')
    await mkdir(dir, { recursive: true })
    const ruta = join(dir, nombre)
    await writeFile(ruta, datos)
    return ruta
  }

  private async guardarAdjuntos(dataUrls: string[]): Promise<string[]> {
    if (!dataUrls.length) return []
    await mkdir(this.d.dirAdjuntos, { recursive: true })
    return Promise.all(
      dataUrls.map(async (url) => {
        const m = /^data:image\/(\w+);base64,(.+)$/s.exec(url)
        if (!m) throw new Error('Adjunto inválido.')
        const datos = Buffer.from(m[2], 'base64')
        const ext = m[1] === 'jpeg' ? 'jpg' : m[1]
        const ruta = join(this.d.dirAdjuntos, `${createHash('sha1').update(datos).digest('hex').slice(0, 16)}.${ext}`)
        await writeFile(ruta, datos)
        return ruta
      })
    )
  }

  // ---------------------------------------------------------------- persistencia

  private async cargar(id: string): Promise<Sesion> {
    const viva = this.sesiones.get(id)
    if (viva) return viva
    const g = await this.d.almacen.leer(id)
    if (!g) throw new Error('No encontré esa conversación.')
    // Las imágenes se vuelven a leer desde sus archivos
    for (const m of g.historial) {
      if (m._imagenes?.length) {
        m.images = await Promise.all(m._imagenes.map((r) => readFile(r).then((b) => b.toString('base64')).catch(() => '')))
        m.images = m.images.filter(Boolean)
      }
    }
    const conv: Conversacion = { ...g.conversacion, permisos: g.conversacion.permisos ?? this.d.ajustes().permisos, ocupada: false }
    const s: Sesion = { conv, historial: g.historial, permitidas: new Set() }
    this.sesiones.set(id, s)
    return s
  }

  private programarGuardado(id: string) {
    const s = this.sesiones.get(id)
    if (!s || s.reloj) return
    s.reloj = setTimeout(() => void this.guardarYa(id), 800)
  }

  private async guardarYa(id: string) {
    const s = this.sesiones.get(id)
    if (!s) return
    if (s.reloj) clearTimeout(s.reloj)
    s.reloj = undefined
    await this.d.almacen.guardar({ conversacion: s.conv, historial: s.historial }).catch(() => undefined)
  }

  async cerrar(): Promise<void> {
    for (const id of this.sesiones.keys()) {
      this.detener(id)
      await this.guardarYa(id)
    }
  }
}

function elegir(lista: string[], preferido?: string): string | undefined {
  return preferido && lista.includes(preferido) ? preferido : lista[0]
}

function sello(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
}
