// Herramientas del agente. Los nombres y descripciones van en inglés: los modelos locales
// las usan mejor así. Lo que ve el usuario (resúmenes) va en español.
import { spawn } from 'node:child_process'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative } from 'node:path'
import { glob } from 'tinyglobby'
import type { Tarea } from '@shared/tipos'
import { dentroDe, resolverRuta } from './permisos'
import type { CtxHerramienta, Herramienta, Resultado } from './tipos'

export const IGNORAR = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/out/**',
  '**/build/**',
  '**/.venv/**',
  '**/venv/**',
  '**/__pycache__/**',
  '**/.next/**',
  '**/target/**',
  '**/bin/**',
  '**/obj/**'
]

export function recortar(texto: string, max: number): string {
  if (texto.length <= max) return texto
  const mitad = Math.floor(max / 2)
  return `${texto.slice(0, mitad)}\n\n[… ${texto.length - max} caracteres recortados …]\n\n${texto.slice(-mitad)}`
}

function rel(ctx: CtxHerramienta, ruta: string): string {
  const r = relative(ctx.carpeta, resolverRuta(ctx.carpeta, ruta))
  return r && dentroDe(ctx.carpeta, ruta) ? r.replaceAll('\\', '/') : resolverRuta(ctx.carpeta, ruta)
}

function esBinario(buf: Buffer): boolean {
  return buf.subarray(0, 8000).includes(0)
}

function contar(texto: string, buscado: string): number {
  if (!buscado) return 0
  let n = 0
  let i = texto.indexOf(buscado)
  while (i >= 0) {
    n++
    i = texto.indexOf(buscado, i + buscado.length)
  }
  return n
}

/** Diff compacto para el aviso de permiso. */
export function diffSimple(antes: string, despues: string, max = 60): string {
  const a = antes.split('\n')
  const b = despues.split('\n')
  let ini = 0
  while (ini < a.length && ini < b.length && a[ini] === b[ini]) ini++
  let finA = a.length - 1
  let finB = b.length - 1
  while (finA >= ini && finB >= ini && a[finA] === b[finB]) {
    finA--
    finB--
  }
  const lineas = [
    `@@ línea ${ini + 1} @@`,
    ...a.slice(ini, finA + 1).map((l) => `- ${l}`),
    ...b.slice(ini, finB + 1).map((l) => `+ ${l}`)
  ]
  return lineas.length > max ? [...lineas.slice(0, max), `… (${lineas.length - max} líneas más)`].join('\n') : lineas.join('\n')
}

const leerArchivo: Herramienta = {
  nombre: 'read_file',
  descripcion:
    'Read a text file from the workspace. Returns lines prefixed with their line number. Use offset/limit for big files. Always read a file before editing it.',
  parametros: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path, relative to the workspace' },
      offset: { type: 'number', description: 'First line to read (1-based)' },
      limit: { type: 'number', description: 'How many lines to read (default 2000)' }
    },
    required: ['path']
  },
  clase: 'lectura',
  resumen: (a) => `Leer ${a.path}`,
  async ejecutar(a, ctx) {
    const ruta = resolverRuta(ctx.carpeta, String(a.path))
    const buf = await readFile(ruta)
    if (esBinario(buf)) return { texto: `${a.path} es un archivo binario (${buf.length} bytes); no se puede leer como texto.` }
    const lineas = buf.toString('utf8').split(/\r?\n/)
    const desde = Math.max(1, Number(a.offset) || 1)
    const cuantas = Math.max(1, Math.min(Number(a.limit) || 2000, 5000))
    const trozo = lineas.slice(desde - 1, desde - 1 + cuantas)
    const cuerpo = trozo.map((l, i) => `${desde + i}\t${l.length > 2000 ? l.slice(0, 2000) + '…' : l}`).join('\n')
    const pie = desde - 1 + cuantas < lineas.length ? `\n[El archivo tiene ${lineas.length} líneas; sigue con offset=${desde + cuantas}]` : ''
    return { texto: (cuerpo || '(archivo vacío)') + pie }
  }
}

const escribirArchivo: Herramienta = {
  nombre: 'write_file',
  descripcion:
    'Create a file or overwrite it completely with new content. Parent folders are created. Prefer edit_file to change part of an existing file.',
  parametros: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path, relative to the workspace' },
      content: { type: 'string', description: 'Full content of the file' }
    },
    required: ['path', 'content']
  },
  clase: 'edicion',
  resumen: (a) => `Escribir ${a.path}`,
  async detalle(a, ctx) {
    const ruta = resolverRuta(ctx.carpeta, String(a.path))
    const antes = await readFile(ruta, 'utf8').catch(() => null)
    const nuevo = String(a.content ?? '')
    if (antes === null) return recortar(nuevo.split('\n').map((l) => `+ ${l}`).join('\n'), 4000)
    return diffSimple(antes, nuevo)
  },
  async ejecutar(a, ctx) {
    const ruta = resolverRuta(ctx.carpeta, String(a.path))
    const existia = await stat(ruta).then(() => true, () => false)
    await mkdir(dirname(ruta), { recursive: true })
    const contenido = String(a.content ?? '')
    await writeFile(ruta, contenido, 'utf8')
    const n = contenido.split('\n').length
    return { texto: `${existia ? 'Reescribí' : 'Creé'} ${rel(ctx, ruta)} (${n} líneas).` }
  }
}

const editarArchivo: Herramienta = {
  nombre: 'edit_file',
  descripcion:
    'Replace an exact piece of text in a file. old_string must match the file exactly (including indentation) and be unique unless replace_all is true. Read the file first.',
  parametros: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path, relative to the workspace' },
      old_string: { type: 'string', description: 'Exact text to replace' },
      new_string: { type: 'string', description: 'Replacement text' },
      replace_all: { type: 'boolean', description: 'Replace every occurrence' }
    },
    required: ['path', 'old_string', 'new_string']
  },
  clase: 'edicion',
  resumen: (a) => `Editar ${a.path}`,
  async detalle(a, ctx) {
    const antes = await readFile(resolverRuta(ctx.carpeta, String(a.path)), 'utf8').catch(() => null)
    if (antes === null) return undefined
    const despues = a.replace_all
      ? antes.split(String(a.old_string)).join(String(a.new_string))
      : antes.replace(String(a.old_string), () => String(a.new_string))
    return diffSimple(antes, despues)
  },
  async ejecutar(a, ctx) {
    const ruta = resolverRuta(ctx.carpeta, String(a.path))
    const antes = await readFile(ruta, 'utf8')
    const viejo = String(a.old_string ?? '')
    const nuevo = String(a.new_string ?? '')
    if (viejo === nuevo) return { texto: 'old_string y new_string son iguales; no hay nada que cambiar.', error: true }
    const veces = contar(antes, viejo)
    if (veces === 0) {
      return { texto: `No encontré old_string en ${a.path}. Vuelve a leer el archivo y copia el fragmento exacto.`, error: true }
    }
    if (veces > 1 && !a.replace_all) {
      return { texto: `old_string aparece ${veces} veces en ${a.path}. Agrega más contexto para que sea único o usa replace_all.`, error: true }
    }
    const despues = a.replace_all ? antes.split(viejo).join(nuevo) : antes.replace(viejo, () => nuevo)
    await writeFile(ruta, despues, 'utf8')
    return { texto: `Edité ${rel(ctx, ruta)} (${a.replace_all ? veces : 1} reemplazo${veces > 1 && a.replace_all ? 's' : ''}).` }
  }
}

const listarArchivos: Herramienta = {
  nombre: 'list_files',
  descripcion:
    'Find files by glob pattern (for example "**/*.ts" or "src/**"). Returns paths relative to the workspace. Ignores node_modules, .git and build folders.',
  parametros: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern, default "**/*"' },
      path: { type: 'string', description: 'Folder to search in, default the workspace' }
    }
  },
  clase: 'lectura',
  resumen: (a) => `Buscar archivos ${a.pattern ?? '**/*'}${a.path ? ` en ${a.path}` : ''}`,
  async ejecutar(a, ctx) {
    const base = resolverRuta(ctx.carpeta, String(a.path ?? '.'))
    const encontrados = await glob(String(a.pattern || '**/*'), { cwd: base, ignore: IGNORAR, dot: true, onlyFiles: true })
    encontrados.sort()
    const max = 300
    const lista = encontrados.slice(0, max).join('\n')
    if (!encontrados.length) return { texto: 'No hay archivos que coincidan.' }
    return { texto: lista + (encontrados.length > max ? `\n[… y ${encontrados.length - max} más; afina el patrón]` : '') }
  }
}

const buscarTexto: Herramienta = {
  nombre: 'grep',
  descripcion:
    'Search file contents with a regular expression. Returns matching lines as path:line: text. Use glob to limit the files (for example "**/*.py").',
  parametros: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regular expression (JavaScript syntax)' },
      path: { type: 'string', description: 'Folder to search in, default the workspace' },
      glob: { type: 'string', description: 'Only files matching this glob' },
      ignore_case: { type: 'boolean' }
    },
    required: ['pattern']
  },
  clase: 'lectura',
  resumen: (a) => `Buscar «${a.pattern}»${a.glob ? ` en ${a.glob}` : ''}`,
  async ejecutar(a, ctx) {
    let re: RegExp
    try {
      re = new RegExp(String(a.pattern), a.ignore_case ? 'i' : '')
    } catch (e) {
      return { texto: `Expresión inválida: ${(e as Error).message}`, error: true }
    }
    const base = resolverRuta(ctx.carpeta, String(a.path ?? '.'))
    const archivos = (await glob(String(a.glob || '**/*'), { cwd: base, ignore: IGNORAR, dot: true, onlyFiles: true })).slice(0, 8000)
    const hallazgos: string[] = []
    for (const archivo of archivos) {
      if (ctx.signal.aborted || hallazgos.length >= 150) break
      const ruta = join(base, archivo)
      const info = await stat(ruta).catch(() => null)
      if (!info || info.size > 1_500_000) continue
      const buf = await readFile(ruta).catch(() => null)
      if (!buf || esBinario(buf)) continue
      const lineas = buf.toString('utf8').split(/\r?\n/)
      for (let i = 0; i < lineas.length && hallazgos.length < 150; i++) {
        if (re.test(lineas[i])) hallazgos.push(`${rel(ctx, ruta)}:${i + 1}: ${lineas[i].trim().slice(0, 300)}`)
      }
    }
    if (!hallazgos.length) return { texto: 'Sin coincidencias.' }
    return { texto: hallazgos.join('\n') + (hallazgos.length >= 150 ? '\n[Hay más; afina la búsqueda]' : '') }
  }
}

export function shellDelSistema(): { programa: string; args: (c: string) => string[]; nombre: string } {
  if (process.platform === 'win32') {
    // Salida en UTF-8 (si no, las tildes llegan en cp1252) y el código de salida real del último programa
    const envolver = (c: string) =>
      `[Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Text.Encoding]::UTF8; $global:LASTEXITCODE = 0\n${c}\n$ok = $?; if ($LASTEXITCODE) { exit $LASTEXITCODE }; if (-not $ok) { exit 1 }`
    return {
      programa: 'powershell.exe',
      args: (c) => ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', envolver(c)],
      nombre: 'PowerShell'
    }
  }
  const sh = process.env.SHELL || '/bin/bash'
  return { programa: sh, args: (c) => ['-lc', c], nombre: basename(sh) }
}

const correrComando: Herramienta = {
  nombre: 'run_command',
  descripcion: `Run a shell command in the workspace and return its output and exit code. The shell is ${shellDelSistema().nombre}. Use it for builds, tests, git and package managers. Do not start servers that never exit.`,
  parametros: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Command to run' },
      timeout_seconds: { type: 'number', description: 'Max seconds to wait (default 120, max 600)' }
    },
    required: ['command']
  },
  clase: 'comando',
  resumen: (a) => `Ejecutar: ${a.command}`,
  async detalle(a) {
    return String(a.command)
  },
  ejecutar(a, ctx) {
    const shell = shellDelSistema()
    const limite = Math.min(Math.max(Number(a.timeout_seconds) || 120, 1), 600) * 1000
    return new Promise<Resultado>((ok) => {
      const hijo = spawn(shell.programa, shell.args(String(a.command)), {
        cwd: ctx.carpeta,
        env: { ...process.env, TERM: 'dumb', NO_COLOR: '1' },
        windowsHide: true
      })
      let salida = ''
      let cortado = false
      const sumar = (d: Buffer) => {
        salida += d.toString('utf8')
        if (salida.length > 200_000) salida = salida.slice(-150_000)
      }
      hijo.stdout.on('data', sumar)
      hijo.stderr.on('data', sumar)
      const matar = () => {
        cortado = true
        if (process.platform === 'win32' && hijo.pid) spawn('taskkill', ['/pid', String(hijo.pid), '/T', '/F'], { windowsHide: true })
        else hijo.kill('SIGKILL')
      }
      const reloj = setTimeout(matar, limite)
      ctx.signal.addEventListener('abort', matar, { once: true })
      hijo.on('error', (e) => {
        clearTimeout(reloj)
        ok({ texto: `No se pudo ejecutar: ${e.message}`, error: true })
      })
      hijo.on('close', (codigo) => {
        clearTimeout(reloj)
        ctx.signal.removeEventListener('abort', matar)
        const texto = recortar(salida.trim(), 30_000) || '(sin salida)'
        const motivo = cortado ? (ctx.signal.aborted ? 'detenido por el usuario' : `se pasó de ${limite / 1000} s y se cortó`) : `código de salida ${codigo}`
        ok({ texto: `${texto}\n[${motivo}]`, error: cortado || codigo !== 0 })
      })
    })
  }
}

export function htmlATexto(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim()
}

const leerWeb: Herramienta = {
  nombre: 'web_fetch',
  descripcion: 'Download a web page (http/https) and return its text content.',
  parametros: {
    type: 'object',
    properties: { url: { type: 'string', description: 'Full URL' } },
    required: ['url']
  },
  clase: 'red',
  resumen: (a) => `Leer ${a.url}`,
  async ejecutar(a, ctx) {
    const url = new URL(String(a.url))
    if (!/^https?:$/.test(url.protocol)) return { texto: 'Solo se permiten URLs http o https.', error: true }
    const r = await fetch(url, {
      signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(20_000)]),
      headers: { 'User-Agent': 'Taller/0.1 (+agente local)' }
    })
    const tipo = r.headers.get('content-type') ?? ''
    const cuerpo = await r.text()
    const texto = tipo.includes('html') ? htmlATexto(cuerpo) : cuerpo
    return { texto: `HTTP ${r.status} · ${tipo}\n\n${recortar(texto, 20_000)}`, error: !r.ok }
  }
}

const ESTADOS: Record<string, Tarea['estado']> = {
  pending: 'pendiente',
  in_progress: 'en_curso',
  completed: 'hecha'
}

const listaTareas: Herramienta = {
  nombre: 'todo_write',
  descripcion:
    'Keep a short task list for multi-step work. Send the full list every time; mark one item in_progress while you work on it and completed when done.',
  parametros: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            content: { type: 'string' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] }
          },
          required: ['content', 'status']
        }
      }
    },
    required: ['todos']
  },
  clase: 'interna',
  resumen: () => 'Actualizar la lista de tareas',
  async ejecutar(a, ctx) {
    const tareas: Tarea[] = (Array.isArray(a.todos) ? a.todos : []).map((t: any) => ({
      contenido: String(t?.content ?? ''),
      estado: ESTADOS[String(t?.status)] ?? 'pendiente'
    }))
    ctx.ponerTareas(tareas)
    const hechas = tareas.filter((t) => t.estado === 'hecha').length
    return { texto: `Lista actualizada: ${hechas}/${tareas.length} hechas.` }
  }
}

const subagente: Herramienta = {
  nombre: 'task',
  descripcion:
    'Hand a self-contained research question to a helper agent with read-only tools and a fresh context. Use it to explore a large codebase without filling your own context. It returns a summary.',
  parametros: {
    type: 'object',
    properties: {
      description: { type: 'string', description: 'Three to five words describing the task' },
      prompt: { type: 'string', description: 'Full instructions for the helper, including what to report back' }
    },
    required: ['description', 'prompt']
  },
  clase: 'interna',
  resumen: (a) => `Subagente: ${a.description}`,
  async ejecutar(a, ctx) {
    const texto = await ctx.subagente(String(a.prompt), String(a.description))
    return { texto: texto || 'El subagente no devolvió nada.' }
  }
}

export const HERRAMIENTAS_BASE: Herramienta[] = [
  leerArchivo,
  listarArchivos,
  buscarTexto,
  editarArchivo,
  escribirArchivo,
  correrComando,
  leerWeb,
  listaTareas,
  subagente
]

// ------------------------------------------------------------------ búsqueda por significado

const EXT_TEXTO = new Set(
  'md txt rst ts tsx js jsx mjs cjs py java cs go rs rb php kt swift c cc cpp h hpp json yml yaml toml ini html css scss sql sh ps1 vue svelte xml'.split(' ')
)

interface Trozo {
  archivo: string
  desde: number
  hasta: number
  texto: string
  vector: number[]
}

const indices = new Map<string, { modelo: string; creado: number; trozos: Trozo[] }>()

function coseno(a: number[], b: number[]): number {
  let p = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    p += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return p / (Math.sqrt(na * nb) || 1)
}

async function indexar(ctx: CtxHerramienta, modelo: string): Promise<Trozo[]> {
  const guardado = indices.get(ctx.carpeta)
  if (guardado && guardado.modelo === modelo && Date.now() - guardado.creado < 10 * 60_000) return guardado.trozos
  const archivos = (await glob('**/*', { cwd: ctx.carpeta, ignore: IGNORAR, onlyFiles: true }))
    .filter((a) => EXT_TEXTO.has(extname(a).slice(1).toLowerCase()))
    .slice(0, 400)
  const pendientes: Omit<Trozo, 'vector'>[] = []
  for (const archivo of archivos) {
    const buf = await readFile(join(ctx.carpeta, archivo)).catch(() => null)
    if (!buf || buf.length > 150_000 || esBinario(buf)) continue
    const lineas = buf.toString('utf8').split(/\r?\n/)
    for (let i = 0; i < lineas.length && pendientes.length < 3000; i += 40) {
      const texto = lineas.slice(i, i + 40).join('\n').trim()
      if (texto.length > 20) pendientes.push({ archivo, desde: i + 1, hasta: Math.min(i + 40, lineas.length), texto })
    }
  }
  const trozos: Trozo[] = []
  for (let i = 0; i < pendientes.length; i += 32) {
    if (ctx.signal.aborted) throw new DOMException('Detenido', 'AbortError')
    ctx.progreso(`Indexando la carpeta… ${Math.min(i + 32, pendientes.length)}/${pendientes.length}`)
    const lote = pendientes.slice(i, i + 32)
    const vectores = await ctx.ollama.embeddings(modelo, lote.map((t) => `${t.archivo}\n${t.texto}`.slice(0, 4000)), ctx.signal)
    lote.forEach((t, j) => trozos.push({ ...t, vector: vectores[j] }))
  }
  indices.set(ctx.carpeta, { modelo, creado: Date.now(), trozos })
  return trozos
}

export function busquedaSemantica(modeloEmbeddings: string): Herramienta {
  return {
    nombre: 'semantic_search',
    descripcion:
      'Search the workspace by meaning (not exact words). Good for questions like "where is the login handled?". Returns the most relevant file fragments.',
    parametros: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What you are looking for, in natural language' },
        top_k: { type: 'number', description: 'How many fragments (default 6)' }
      },
      required: ['query']
    },
    clase: 'lectura',
    resumen: (a) => `Buscar por significado: ${a.query}`,
    async ejecutar(a, ctx) {
      const trozos = await indexar(ctx, modeloEmbeddings)
      if (!trozos.length) return { texto: 'La carpeta no tiene archivos de texto para indexar.' }
      const [q] = await ctx.ollama.embeddings(modeloEmbeddings, [String(a.query)], ctx.signal)
      const k = Math.min(Math.max(Number(a.top_k) || 6, 1), 20)
      const mejores = trozos
        .map((t) => ({ t, s: coseno(q, t.vector) }))
        .sort((x, y) => y.s - x.s)
        .slice(0, k)
      return {
        texto: mejores
          .map(({ t, s }) => `### ${t.archivo}:${t.desde}-${t.hasta} (similitud ${s.toFixed(2)})\n${recortar(t.texto, 1500)}`)
          .join('\n\n')
      }
    }
  }
}

// ------------------------------------------------------------------ generación con ComfyUI

function sello(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
}

export function generarImagen(checkpoint: string): Herramienta {
  return {
    nombre: 'generate_image',
    descripcion:
      'Generate an image from a text prompt with the local image model (ComfyUI). Write the prompt in English, describing subject, style, lighting and composition. Returns the saved file path.',
    parametros: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Detailed English prompt' },
        width: { type: 'number', description: 'Default 1024' },
        height: { type: 'number', description: 'Default 1024' }
      },
      required: ['prompt']
    },
    clase: 'generacion',
    resumen: (a) => `Generar imagen: ${String(a.prompt).slice(0, 80)}`,
    async ejecutar(a, ctx) {
      if (!ctx.comfy) return { texto: 'ComfyUI no está disponible.', error: true }
      const png = await ctx.comfy.textoAImagen(
        { prompt: String(a.prompt), checkpoint, ancho: Number(a.width) || 1024, alto: Number(a.height) || 1024 },
        (p) => ctx.progreso(`${Math.round(p.fraccion * 100)}% · ${p.etapa}`),
        ctx.signal
      )
      await mkdir(ctx.salidas, { recursive: true })
      const ruta = join(ctx.salidas, `imagen-${sello()}.png`)
      await writeFile(ruta, png)
      return { texto: `Imagen guardada en ${rel(ctx, ruta)}`, archivos: [{ ruta, tipo: 'imagen' }] }
    }
  }
}

export const SUFIJO_3D = ', single object, centered, full view, plain white background, soft studio light, 3/4 view, no text'

export function generar3d(checkpoint3d: string, checkpointImagen?: string): Herramienta {
  return {
    nombre: 'generate_3d',
    descripcion:
      'Create a 3D model (GLB file) with Hunyuan3D. Give image_path to convert an existing picture, or an English prompt to first draw the object and then convert it. Returns the saved file paths.',
    parametros: {
      type: 'object',
      properties: {
        image_path: { type: 'string', description: 'Picture of a single object, relative to the workspace' },
        prompt: { type: 'string', description: 'English description of the object, if there is no picture' }
      }
    },
    clase: 'generacion',
    resumen: (a) => (a.image_path ? `Modelo 3D desde ${a.image_path}` : `Modelo 3D: ${String(a.prompt ?? '').slice(0, 80)}`),
    async ejecutar(a, ctx) {
      if (!ctx.comfy) return { texto: 'ComfyUI no está disponible.', error: true }
      const archivos: Resultado['archivos'] = []
      await mkdir(ctx.salidas, { recursive: true })
      let imagen: Buffer
      if (a.image_path) {
        imagen = await readFile(resolverRuta(ctx.carpeta, String(a.image_path)))
      } else if (a.prompt && checkpointImagen) {
        imagen = await ctx.comfy.textoAImagen(
          { prompt: String(a.prompt) + SUFIJO_3D, checkpoint: checkpointImagen },
          (p) => ctx.progreso(`Dibujando ${Math.round(p.fraccion * 100)}% · ${p.etapa}`),
          ctx.signal
        )
        const rutaImg = join(ctx.salidas, `referencia-${sello()}.png`)
        await writeFile(rutaImg, imagen)
        archivos.push({ ruta: rutaImg, tipo: 'imagen' })
      } else {
        return { texto: 'Hace falta image_path, o un prompt y un checkpoint de imagen en ComfyUI.', error: true }
      }
      const glb = await ctx.comfy.imagenA3d(
        { imagen, checkpoint: checkpoint3d },
        (p) => ctx.progreso(`3D ${Math.round(p.fraccion * 100)}% · ${p.etapa}`),
        ctx.signal
      )
      const ruta = join(ctx.salidas, `modelo-${sello()}.glb`)
      await writeFile(ruta, glb)
      archivos.push({ ruta, tipo: 'modelo3d' })
      return { texto: `Modelo 3D guardado en ${rel(ctx, ruta)}`, archivos }
    }
  }
}

export function definicion(h: Herramienta) {
  return { type: 'function' as const, function: { name: h.nombre, description: h.descripcion, parameters: h.parametros } }
}
