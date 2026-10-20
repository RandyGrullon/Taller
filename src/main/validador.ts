// Validador: revisa la app, Ollama, los modelos y ComfyUI en este equipo y arma un informe.
// No pide nada: elige solo el modelo para cada prueba y trabaja en una carpeta temporal.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { arch, cpus, release, tmpdir, totalmem, type as tipoSO } from 'node:os'
import { join } from 'node:path'
import type { Ajustes, EstadoMcp, EstadoPrueba, InformeValidacion, ModeloLocal, Prueba } from '@shared/tipos'
import { ETIQUETA_CAPACIDAD } from '@shared/funciones'
import { correrAgente } from './agente/bucle'
import { HERRAMIENTAS_BASE, recortar, shellDelSistema } from './agente/herramientas'
import { extraerLlamadas } from './agente/llamadas'
import { promptDeSistema } from './agente/sistema'
import type { CtxHerramienta } from './agente/tipos'
import type { Comfy } from './comfy'
import { rutasOllama } from './deteccion'
import type { DefinicionHerramienta, Mensaje, Ollama } from './ollama'
import { pngSolido } from './png'

export interface DepsValidador {
  ollama: Ollama
  comfy: Comfy
  ajustes: Ajustes
  version: string
  electron?: string
  mcp(): Promise<EstadoMcp[]>
  dirDatos: string
  /** Pide un archivo por el protocolo taller:// como lo hace la interfaz. */
  probarProtocolo?(ruta: string): Promise<boolean>
  urlInternet?: string
  signal: AbortSignal
  alCambiar(pruebas: Prueba[]): void
}

interface Resultado {
  estado: Exclude<EstadoPrueba, 'pendiente' | 'corriendo'>
  detalle: string
  crudo?: string
}

/** Lanzarlo marca la prueba como omitida, con el motivo. */
class Omitir extends Error {}

interface Ctx {
  tmp: string
  preferido?: string
  ollamaOk: boolean
  modelos: ModeloLocal[]
  imagen?: Buffer
  progreso(texto: string): void
}

interface Definicion {
  id: string
  grupo: string
  nombre: string
  queValida: string
  correr(ctx: Ctx, d: DepsValidador): Promise<Resultado>
}

const bien = (detalle: string, crudo?: string): Resultado => ({ estado: 'ok', detalle, crudo })
const revisar = (detalle: string, crudo?: string): Resultado => ({ estado: 'aviso', detalle, crudo })
const falla = (detalle: string, crudo?: string): Resultado => ({ estado: 'error', detalle, crudo })

const seg = (ms: number) => `${(ms / 1000).toFixed(1)} s`

function caps(m: ModeloLocal): string {
  return m.capacidades.map((c) => ETIQUETA_CAPACIDAD[c]).join(', ')
}

/** El modelo para una prueba: el de la conversación si sirve; si no, el más liviano que sirva. */
function elegir(ctx: Ctx, requiere: ModeloLocal['capacidades'], para: string): ModeloLocal {
  if (!ctx.ollamaOk) throw new Omitir('Ollama no está corriendo.')
  const sirven = ctx.modelos.filter((m) => requiere.every((c) => m.capacidades.includes(c)))
  if (!sirven.length) {
    const falta = requiere.map((c) => ETIQUETA_CAPACIDAD[c]).join(' + ')
    throw new Omitir(`Ningún modelo instalado tiene ${falta}; ${para}.`)
  }
  return sirven.find((m) => m.nombre === ctx.preferido) ?? [...sirven].sort((a, b) => a.tamano - b.tamano)[0]
}

function piensa(m: ModeloLocal): boolean | undefined {
  return m.capacidades.includes('thinking') ? false : undefined
}

function ctxHerramienta(d: DepsValidador, carpeta: string, modelo: string): CtxHerramienta {
  return {
    carpeta,
    salidas: join(carpeta, 'taller-salidas'),
    signal: d.signal,
    ollama: d.ollama,
    modelo,
    ajustes: d.ajustes,
    ponerTareas: () => undefined,
    subagente: async () => '',
    progreso: () => undefined
  }
}

const herramienta = (n: string) => HERRAMIENTAS_BASE.find((h) => h.nombre === n)!

const SUMAR: DefinicionHerramienta = {
  type: 'function',
  function: {
    name: 'sumar',
    description: 'Suma dos números enteros y devuelve el resultado.',
    parameters: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] }
  }
}

export const PRUEBAS: Definicion[] = [
  // ---------------------------------------------------------------- la app
  {
    id: 'sistema',
    grupo: 'Taller en este equipo',
    nombre: 'Versión y sistema',
    queValida: 'Qué versión de Taller corre y en qué sistema, para saber con qué se hizo la prueba.',
    async correr(_ctx, d) {
      const cpu = cpus()[0]?.model?.replace(/\s+/g, ' ').trim() ?? 'CPU desconocida'
      return bien(
        `Taller ${d.version}${d.electron ? ` · Electron ${d.electron}` : ''} · ${tipoSO()} ${release()} (${arch()}) · ${cpu} ×${cpus().length} · ${Math.round(totalmem() / 2 ** 30)} GB de RAM`
      )
    }
  },
  {
    id: 'datos',
    grupo: 'Taller en este equipo',
    nombre: 'Carpeta de datos',
    queValida: 'Que Taller puede escribir y leer donde guarda tus ajustes y conversaciones.',
    async correr(_ctx, d) {
      await mkdir(d.dirDatos, { recursive: true })
      const archivo = join(d.dirDatos, `.prueba-${Date.now()}`)
      await writeFile(archivo, 'taller', 'utf8')
      const leido = await readFile(archivo, 'utf8')
      await rm(archivo, { force: true })
      return leido === 'taller' ? bien(`Se puede escribir en ${d.dirDatos}`) : falla('Lo que se leyó no coincide con lo escrito.')
    }
  },
  {
    id: 'archivos',
    grupo: 'Taller en este equipo',
    nombre: 'Herramientas de archivos del agente',
    queValida: 'Que el agente puede crear, leer, editar, listar y buscar archivos en tu disco. Se prueba en una carpeta temporal.',
    async correr(ctx, d) {
      const carpeta = join(ctx.tmp, 'archivos')
      await mkdir(carpeta, { recursive: true })
      const c = ctxHerramienta(d, carpeta, '')
      const fallas: string[] = []
      const probar = async (nombre: string, args: Record<string, unknown>, esperado: (t: string) => boolean) => {
        const r = await herramienta(nombre).ejecutar(args, c)
        if (r.error || !esperado(r.texto)) fallas.push(`${nombre}: ${r.texto.slice(0, 120)}`)
      }
      await probar('write_file', { path: 'notas/prueba.txt', content: 'uno\ndos // TODO revisar\ntres\n' }, (t) => t.includes('Creé'))
      await probar('edit_file', { path: 'notas/prueba.txt', old_string: 'uno', new_string: 'UNO' }, (t) => t.includes('Edité'))
      await probar('read_file', { path: 'notas/prueba.txt' }, (t) => t.startsWith('1\tUNO'))
      await probar('list_files', { pattern: '**/*.txt' }, (t) => t.trim() === 'notas/prueba.txt')
      await probar('grep', { pattern: 'TODO' }, (t) => t.startsWith('notas/prueba.txt:2:'))
      return fallas.length ? falla(`${5 - fallas.length} de 5 funcionan.`, fallas.join('\n')) : bien('write_file, edit_file, read_file, list_files y grep funcionan.')
    }
  },
  {
    id: 'terminal',
    grupo: 'Taller en este equipo',
    nombre: 'Terminal',
    queValida: `Que el agente puede ejecutar comandos en ${shellDelSistema().nombre} y que las tildes llegan bien.`,
    async correr(ctx, d) {
      const comando = process.platform === 'win32' ? "Write-Output 'canción ñandú 123'" : "echo 'canción ñandú 123'"
      const r = await herramienta('run_command').ejecutar({ command: comando, timeout_seconds: 30 }, ctxHerramienta(d, ctx.tmp, ''))
      if (r.error) return falla('El comando falló.', r.texto)
      return r.texto.includes('canción ñandú') ? bien(`${shellDelSistema().nombre} responde y las tildes llegan bien.`, r.texto) : revisar('El comando corre, pero las tildes llegan mal.', r.texto)
    }
  },
  {
    id: 'visor',
    grupo: 'Taller en este equipo',
    nombre: 'Visor de imágenes y 3D',
    queValida: 'Que la ventana puede mostrar las imágenes y modelos 3D que genera (protocolo interno taller://).',
    async correr(ctx, d) {
      if (!d.probarProtocolo) throw new Omitir('Solo se prueba dentro de la app.')
      const ruta = join(ctx.tmp, 'visor.png')
      await writeFile(ruta, pngSolido(8, 8, [200, 90, 50]))
      return (await d.probarProtocolo(ruta)) ? bien('La app sirve los archivos generados.') : falla('El protocolo taller:// no devolvió la imagen.')
    }
  },
  {
    id: 'gpu',
    grupo: 'Taller en este equipo',
    nombre: 'Tarjeta de video',
    queValida: 'Qué GPU NVIDIA tienes, su driver y su memoria: de eso depende qué modelos te caben y si ComfyUI puede hacer 3D.',
    async correr() {
      const salida = await new Promise<string>((ok) =>
        execFile('nvidia-smi', ['--query-gpu=name,driver_version,memory.total', '--format=csv,noheader'], { timeout: 5000, windowsHide: true }, (err, out) =>
          ok(err ? '' : out.trim())
        )
      )
      if (!salida) return revisar('No encontré una GPU NVIDIA (nvidia-smi). Los modelos correrán en la CPU, más lentos, y el 3D no funcionará.')
      const [nombre, driver, memoria] = salida.split('\n')[0].split(',').map((s) => s.trim())
      return bien(`${nombre} · ${memoria} · driver ${driver}`)
    }
  },
  {
    id: 'internet',
    grupo: 'Taller en este equipo',
    nombre: 'Internet',
    queValida: 'Que puedes llegar a ollama.com para bajar Ollama y modelos. Sin internet, lo que ya tienes funciona igual.',
    async correr(_ctx, d) {
      const url = d.urlInternet ?? 'https://ollama.com'
      try {
        const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.any([d.signal, AbortSignal.timeout(6000)]) })
        return bien(`${new URL(url).host} responde (HTTP ${r.status}).`)
      } catch {
        return revisar(`No llegué a ${new URL(url).host}. Solo hace falta para descargar.`)
      }
    }
  },

  // ---------------------------------------------------------------- Ollama
  {
    id: 'ollama',
    grupo: 'Ollama',
    nombre: 'Ollama corriendo',
    queValida: 'Que Ollama está instalado y responde en la dirección de Ajustes.',
    async correr(ctx, d) {
      try {
        const version = await d.ollama.version(4000)
        ctx.ollamaOk = true
        return bien(`Ollama ${version} en ${d.ollama.url}`)
      } catch {
        const ejecutable = rutasOllama().find((r) => existsSync(r))
        return falla(ejecutable ? `Está instalado (${ejecutable}) pero no responde en ${d.ollama.url}. Ábrelo.` : `No responde en ${d.ollama.url} y no lo encontré instalado. Bájalo de ollama.com/download.`)
      }
    }
  },
  {
    id: 'modelos',
    grupo: 'Ollama',
    nombre: 'Modelos y capacidades',
    queValida: 'Qué modelos tienes y qué sabe hacer cada uno según Ollama. Esto decide qué funciones se activan o se bloquean.',
    async correr(ctx, d) {
      if (!ctx.ollamaOk) throw new Omitir('Ollama no está corriendo.')
      ctx.modelos = await d.ollama.modelos()
      if (!ctx.modelos.length) return revisar('Ollama no tiene modelos. Descarga uno desde la vista Modelos.')
      const lineas = ctx.modelos.map((m) => `${m.nombre}: ${caps(m)}${m.contexto ? ` · ${Math.round(m.contexto / 1024)}K de contexto` : ''}`)
      return bien(`${ctx.modelos.length} modelo${ctx.modelos.length === 1 ? '' : 's'}: ${ctx.modelos.map((m) => m.nombre).join(', ')}`, lineas.join('\n'))
    }
  },

  // ---------------------------------------------------------------- modelos
  {
    id: 'chat',
    grupo: 'Modelos',
    nombre: 'Chat',
    queValida: 'Que un modelo responde y el texto llega en vivo. Mide cuánto tarda en cargar, en empezar y la velocidad.',
    async correr(ctx, d) {
      const m = elegir(ctx, ['completion'], 'descarga uno de texto')
      ctx.progreso(`Cargando ${m.nombre}…`)
      const inicio = Date.now()
      let primera = 0
      const r = await d.ollama.chat(
        { model: m.nombre, messages: [{ role: 'user', content: 'Responde solo con la palabra: listo' }], think: piensa(m), options: { num_ctx: 4096, temperature: 0 } },
        () => (primera ||= Date.now() - inicio),
        d.signal
      )
      if (!r.content.trim()) return falla(`${m.nombre} no devolvió texto.`, r.thinking)
      const velocidad = r.evalNs ? ` · ${(r.evalTokens / (r.evalNs / 1e9)).toFixed(0)} tokens/s` : ''
      const carga = r.cargaNs ? ` · cargó en ${seg(r.cargaNs / 1e6)}` : ''
      return bien(`${m.nombre}: empezó a responder en ${seg(primera)}${velocidad}${carga}`, r.content.trim())
    }
  },
  {
    id: 'herramientas',
    grupo: 'Modelos',
    nombre: 'Llamada a herramientas',
    queValida: 'Que el modelo pide herramientas en el formato que Taller entiende. Sin esto, el modo Agente no sirve con ese modelo.',
    async correr(ctx, d) {
      const m = elegir(ctx, ['completion', 'tools'], 'el modo Agente necesita uno con Herramientas')
      const mensajes: Mensaje[] = [{ role: 'user', content: 'Usa la herramienta sumar para calcular 1234 + 4321. No hagas la cuenta tú.' }]
      const pedido = { model: m.nombre, tools: [SUMAR], think: piensa(m), options: { num_ctx: 4096, temperature: 0 } }
      const r1 = await d.ollama.chat({ ...pedido, messages: mensajes }, () => undefined, d.signal)
      let llamadas = r1.tool_calls
      let rescate = false
      if (!llamadas.length) {
        llamadas = extraerLlamadas(r1.content, ['sumar']).llamadas
        rescate = llamadas.length > 0
      }
      if (!llamadas.length) return falla(`${m.nombre} respondió con texto en vez de pedir la herramienta.`, r1.content)
      const a = llamadas[0].function.arguments as Record<string, unknown>
      const argsBien = [Number(a.a), Number(a.b)].sort().join() === [1234, 4321].sort().join()
      const r2 = await d.ollama.chat(
        { ...pedido, messages: [...mensajes, { role: 'assistant', content: r1.content, tool_calls: llamadas }, { role: 'tool', tool_name: 'sumar', content: '5555' }] },
        () => undefined,
        d.signal
      )
      const crudo = `Llamada: ${JSON.stringify(llamadas[0].function)}\nRespuesta final: ${r2.content.trim()}`
      const usaResultado = r2.content.includes('5555') || r2.content.includes('5.555') || r2.content.includes('5,555')
      if (rescate) return revisar(`${m.nombre} escribió la llamada como texto; Taller la rescata, pero puede fallar en tareas largas.`, crudo)
      if (!argsBien) return revisar(`${m.nombre} llamó la herramienta con números equivocados.`, crudo)
      if (!usaResultado) return revisar(`${m.nombre} llamó bien la herramienta, pero no usó el resultado en su respuesta.`, crudo)
      return bien(`${m.nombre} pidió sumar(1234, 4321) y usó el resultado 5555.`, crudo)
    }
  },
  {
    id: 'agente',
    grupo: 'Modelos',
    nombre: 'Agente completo',
    queValida: 'Una tarea real con el mismo bucle del modo Agente: crear un archivo y leerlo para confirmarlo.',
    async correr(ctx, d) {
      const m = elegir(ctx, ['completion', 'tools'], 'el modo Agente necesita uno con Herramientas')
      const carpeta = join(ctx.tmp, 'agente')
      await mkdir(carpeta, { recursive: true })
      const herramientas = ['read_file', 'write_file', 'list_files'].map(herramienta)
      const usadas: string[] = []
      const historial: Mensaje[] = [{ role: 'user', content: 'Crea el archivo prueba-taller.txt con el texto "hola desde Taller" y después léelo para confirmar que quedó bien.' }]
      const contexto = Math.min(8192, m.contexto ?? 8192)
      const final = await correrAgente({
        ollama: d.ollama,
        modelo: m.nombre,
        capacidades: m.capacidades,
        sistema: promptDeSistema({ modelo: m.nombre, carpeta, conHerramientas: true, modoPermiso: 'todo', herramientas: herramientas.map((h) => h.nombre) }),
        historial,
        herramientas,
        modoPermiso: 'todo',
        pensar: false,
        contexto,
        maxPasos: 8,
        signal: d.signal,
        permitidas: new Set(),
        ctx: ctxHerramienta(d, carpeta, m.nombre),
        emitir: (e) => {
          if (e.tipo === 'item' && e.item.tipo === 'herramienta') {
            usadas.push(e.item.nombre)
            ctx.progreso(`${m.nombre} usa ${e.item.nombre}…`)
          }
        },
        pedirPermiso: async () => 'si'
      })
      const contenido = await readFile(join(carpeta, 'prueba-taller.txt'), 'utf8').catch(() => null)
      const crudo = `Herramientas: ${usadas.join(' → ') || 'ninguna'}\nRespuesta: ${recortar(final, 600)}`
      if (contenido === null) return falla(`${m.nombre} no creó el archivo.`, crudo)
      if (!/hola desde taller/i.test(contenido)) return revisar(`${m.nombre} creó el archivo, pero con otro texto.`, `${crudo}\nArchivo: ${contenido}`)
      const leyo = usadas.includes('read_file')
      return leyo
        ? bien(`${m.nombre} creó y leyó el archivo (${usadas.join(' → ')}).`, crudo)
        : revisar(`${m.nombre} creó el archivo pero no lo leyó para confirmar.`, crudo)
    }
  },
  {
    id: 'pensar',
    grupo: 'Modelos',
    nombre: 'Razonamiento',
    queValida: 'Que el botón Pensar funciona: el razonamiento llega aparte y la respuesta sale correcta.',
    async correr(ctx, d) {
      const m = elegir(ctx, ['completion', 'thinking'], 'el botón Pensar necesita uno que Razone')
      const r = await d.ollama.chat(
        { model: m.nombre, messages: [{ role: 'user', content: '¿Cuánto es 17 × 23? Responde solo con el número.' }], think: true, options: { num_ctx: 4096, temperature: 0 } },
        () => undefined,
        d.signal
      )
      const crudo = `Pensamiento: ${recortar(r.thinking, 800)}\nRespuesta: ${r.content.trim()}`
      if (!r.thinking.trim()) return revisar(`${m.nombre} respondió sin razonamiento aparte.`, crudo)
      return r.content.includes('391') ? bien(`${m.nombre} razonó (${r.thinking.length} caracteres) y respondió 391.`, crudo) : revisar(`${m.nombre} razonó, pero la respuesta no fue 391.`, crudo)
    }
  },
  {
    id: 'vision',
    grupo: 'Modelos',
    nombre: 'Visión',
    queValida: 'Que el modelo ve imágenes: se le muestra un cuadro rojo y debe decir de qué color es.',
    async correr(ctx, d) {
      const m = elegir(ctx, ['completion', 'vision'], 'adjuntar imágenes necesita uno con Visión')
      const imagen = pngSolido(96, 96, [215, 30, 30]).toString('base64')
      const r = await d.ollama.chat(
        {
          model: m.nombre,
          messages: [{ role: 'user', content: '¿De qué color es esta imagen? Responde con una sola palabra en español.', images: [imagen] }],
          think: piensa(m),
          options: { num_ctx: 4096, temperature: 0 }
        },
        () => undefined,
        d.signal
      )
      return /roj|red/i.test(r.content) ? bien(`${m.nombre} vio el cuadro rojo.`, r.content.trim()) : revisar(`${m.nombre} no reconoció el color.`, r.content.trim())
    }
  },
  {
    id: 'embeddings',
    grupo: 'Modelos',
    nombre: 'Búsqueda por significado',
    queValida: 'Que «Buscar en documentos» funciona: dos frases parecidas deben quedar más cerca entre sí que de una distinta.',
    async correr(ctx, d) {
      if (!ctx.ollamaOk) throw new Omitir('Ollama no está corriendo.')
      const emb = ctx.modelos.filter((m) => m.capacidades.includes('embedding'))
      if (!emb.length) throw new Omitir('No hay un modelo de embeddings; instala nomic-embed-text.')
      const m = emb.find((x) => x.nombre === d.ajustes.modeloEmbeddings) ?? emb[0]
      const [a, b, c] = await d.ollama.embeddings(m.nombre, ['El perro ladra en el parque', 'Un perro juega en el parque', 'Declaración anual de impuestos'], d.signal)
      const coseno = (x: number[], y: number[]) => {
        let p = 0
        let nx = 0
        let ny = 0
        for (let i = 0; i < x.length; i++) {
          p += x[i] * y[i]
          nx += x[i] ** 2
          ny += y[i] ** 2
        }
        return p / (Math.sqrt(nx * ny) || 1)
      }
      const cerca = coseno(a, b)
      const lejos = coseno(a, c)
      const detalle = `${m.nombre} (${a.length} dimensiones): parecidas ${cerca.toFixed(2)} · distintas ${lejos.toFixed(2)}`
      return cerca > lejos ? bien(detalle) : revisar(`${detalle}. Deberían quedar más cerca las parecidas.`)
    }
  },

  // ---------------------------------------------------------------- ComfyUI
  {
    id: 'comfy',
    grupo: 'Imágenes y 3D',
    nombre: 'ComfyUI',
    queValida: 'Que ComfyUI responde, qué GPU usa y si tiene un checkpoint de imagen y los nodos y el checkpoint de Hunyuan3D.',
    async correr(_ctx, d) {
      const e = await d.comfy.estado()
      if (!e.conectado) return revisar(`No responde en ${d.comfy.url}. Es opcional: sin él, Imagen y 3D quedan bloqueados.`)
      const partes = [
        e.mensaje,
        e.vramGb ? `${e.vramGb} GB de VRAM` : '',
        `imagen: ${e.checkpointsImagen.length ? e.checkpointsImagen.join(', ') : 'sin checkpoint'}`,
        `3D: ${e.nodos3d ? (e.checkpoints3d.length ? e.checkpoints3d.join(', ') : 'sin checkpoint de Hunyuan3D') : `faltan nodos (${e.faltan.join(', ')})`}`
      ].filter(Boolean)
      const completo = e.checkpointsImagen.length > 0 && e.nodos3d && e.checkpoints3d.length > 0
      return completo ? bien(partes.join(' · ')) : revisar(partes.join(' · '))
    }
  },
  {
    id: 'imagen',
    grupo: 'Imágenes y 3D',
    nombre: 'Generar una imagen',
    queValida: 'Una imagen real de 768×768 con tu checkpoint, para medir cuánto tarda en tu GPU.',
    async correr(ctx, d) {
      const e = await d.comfy.estado()
      if (!e.conectado) throw new Omitir('ComfyUI no está corriendo.')
      if (!e.checkpointsImagen.length) throw new Omitir('ComfyUI no tiene un checkpoint de imagen.')
      const checkpoint = e.checkpointsImagen.includes(d.ajustes.checkpointImagen ?? '') ? d.ajustes.checkpointImagen! : e.checkpointsImagen[0]
      const png = await d.comfy.textoAImagen(
        { prompt: 'a red apple on a wooden table, soft studio light, photo', checkpoint, ancho: 768, alto: 768 },
        (p) => ctx.progreso(`${Math.round(p.fraccion * 100)}% · ${p.etapa}`),
        d.signal
      )
      if (png.subarray(1, 4).toString() !== 'PNG') return falla('ComfyUI devolvió algo que no es una imagen PNG.')
      ctx.imagen = png
      const ruta = join(ctx.tmp, 'imagen.png')
      await writeFile(ruta, png)
      return bien(`${checkpoint} · ${Math.round(png.length / 1024)} KB`, ruta)
    }
  },
  {
    id: '3d',
    grupo: 'Imágenes y 3D',
    nombre: 'Generar un modelo 3D',
    queValida: 'Convierte esa imagen en un modelo 3D con Hunyuan3D y revisa que el GLB sea válido. Es lo más pesado: puede tardar minutos.',
    async correr(ctx, d) {
      const e = await d.comfy.estado()
      if (!e.conectado) throw new Omitir('ComfyUI no está corriendo.')
      if (!e.nodos3d || !e.checkpoints3d.length) throw new Omitir('ComfyUI no tiene Hunyuan3D listo.')
      const imagen = ctx.imagen ?? pngSolido(256, 256, [200, 120, 70])
      const checkpoint = e.checkpoints3d.includes(d.ajustes.checkpoint3d ?? '') ? d.ajustes.checkpoint3d! : e.checkpoints3d[0]
      const glb = await d.comfy.imagenA3d({ imagen, checkpoint }, (p) => ctx.progreso(`${Math.round(p.fraccion * 100)}% · ${p.etapa}`), d.signal)
      if (glb.subarray(0, 4).toString() !== 'glTF') return falla('ComfyUI devolvió algo que no es un GLB.')
      const ruta = join(ctx.tmp, 'modelo.glb')
      await writeFile(ruta, glb)
      return bien(`${checkpoint} · GLB de ${(glb.length / 2 ** 20).toFixed(1)} MB`, ruta)
    }
  },

  // ---------------------------------------------------------------- extras
  {
    id: 'mcp',
    grupo: 'Extras',
    nombre: 'Servidores MCP',
    queValida: 'Que los servidores MCP de Ajustes arrancan y le dan herramientas al agente.',
    async correr(_ctx, d) {
      const servidores = await d.mcp()
      if (!servidores.length) throw new Omitir('No tienes servidores MCP configurados (es opcional).')
      const lineas = servidores.map((s) => `${s.nombre}: ${s.estado === 'conectado' ? `${s.herramientas.length} herramientas` : (s.error ?? s.estado)}`)
      const conError = servidores.filter((s) => s.estado === 'error')
      return conError.length ? falla(`${conError.length} de ${servidores.length} no arrancan.`, lineas.join('\n')) : bien(lineas.join(' · '))
    }
  }
]

export async function validar(preferido: string | undefined, d: DepsValidador): Promise<InformeValidacion> {
  const tmp = await mkdtemp(join(tmpdir(), 'taller-validacion-'))
  let pruebas: Prueba[] = PRUEBAS.map(({ id, grupo, nombre, queValida }) => ({ id, grupo, nombre, queValida, estado: 'pendiente' }))
  const poner = (id: string, cambios: Partial<Prueba>) => {
    pruebas = pruebas.map((p) => (p.id === id ? { ...p, ...cambios } : p))
    d.alCambiar(pruebas)
  }
  d.alCambiar(pruebas)
  const ctx: Ctx = { tmp, preferido, ollamaOk: false, modelos: [], progreso: () => undefined }

  for (const def of PRUEBAS) {
    if (d.signal.aborted) {
      poner(def.id, { estado: 'omitida', detalle: 'Detenido.' })
      continue
    }
    const inicio = Date.now()
    ctx.progreso = (texto) => poner(def.id, { detalle: texto })
    poner(def.id, { estado: 'corriendo', detalle: undefined })
    try {
      const r = await def.correr(ctx, d)
      poner(def.id, { ...r, crudo: r.crudo ? recortar(r.crudo, 2500) : undefined, ms: Date.now() - inicio })
    } catch (e) {
      if (e instanceof Omitir) poner(def.id, { estado: 'omitida', detalle: e.message })
      else if (d.signal.aborted) poner(def.id, { estado: 'omitida', detalle: 'Detenido.' })
      else poner(def.id, { estado: 'error', detalle: (e as Error).message || String(e), ms: Date.now() - inicio })
    }
  }

  const fecha = new Date().toISOString()
  return { fecha, pruebas, carpeta: tmp, markdown: informe(pruebas, fecha, d, tmp) }
}

const MARCA: Record<EstadoPrueba, string> = { ok: '✅', aviso: '⚠️', error: '❌', omitida: '⏭️', pendiente: '⏳', corriendo: '⏳' }

export function informe(pruebas: Prueba[], fecha: string, d: Pick<DepsValidador, 'version' | 'dirDatos'>, tmp: string): string {
  const cuenta = (e: EstadoPrueba) => pruebas.filter((p) => p.estado === e).length
  const lineas = [
    '# Informe del validador de Taller',
    '',
    `- **Fecha:** ${fecha.replace('T', ' ').slice(0, 16)} (UTC)`,
    `- **Versión:** Taller ${d.version}`,
    `- **Resultado:** ${cuenta('ok')} bien · ${cuenta('aviso')} para revisar · ${cuenta('error')} fallas · ${cuenta('omitida')} omitidas`,
    ''
  ]
  let grupo = ''
  for (const p of pruebas) {
    if (p.grupo !== grupo) {
      grupo = p.grupo
      lineas.push(`## ${grupo}`, '', '| | Prueba | Resultado | Tiempo |', '|---|---|---|---:|')
    }
    const detalle = (p.detalle ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')
    lineas.push(`| ${MARCA[p.estado]} | ${p.nombre} | ${detalle} | ${p.ms !== undefined ? seg(p.ms) : ''} |`)
    const siguiente = pruebas[pruebas.indexOf(p) + 1]
    if (!siguiente || siguiente.grupo !== grupo) lineas.push('')
  }
  const conCrudo = pruebas.filter((p) => p.crudo)
  if (conCrudo.length) {
    lineas.push('## Lo que respondieron', '')
    for (const p of conCrudo) lineas.push(`### ${p.nombre}`, '', `_${p.queValida}_`, '', '```text', p.crudo!, '```', '')
  }
  lineas.push(
    '## Para mandarlo',
    '',
    '- Este informe completo.',
    `- Si algo falló en una conversación, la carpeta \`${join(d.dirDatos, 'conversaciones')}\` en un zip.`,
    `- Los archivos de esta prueba quedaron en \`${tmp}\`.`
  )
  return lineas.join('\n')
}
