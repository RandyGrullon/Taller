// Ollama simulado: mismas rutas y formato NDJSON que el real, para probar Taller sin GPU.
//   node scripts/ollama-simulado.mjs [--puerto 11434] [--vacio]
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { semilla } from './lib/medios.mjs'

const CONOCIDOS = {
  'qwen3.5:9b': { caps: ['completion', 'vision', 'tools', 'thinking'], fam: 'qwen35', params: '9.7B', gb: 6.6, ctx: 262144 },
  'qwen3:8b': { caps: ['completion', 'tools', 'thinking'], fam: 'qwen3', params: '8.2B', gb: 5.2, ctx: 40960 },
  'qwen3:14b': { caps: ['completion', 'tools', 'thinking'], fam: 'qwen3', params: '14.8B', gb: 9.3, ctx: 40960 },
  'qwen3-vl:8b': { caps: ['completion', 'vision', 'tools', 'thinking'], fam: 'qwen3vl', params: '8.8B', gb: 6.1, ctx: 262144 },
  'qwen3-coder:30b': { caps: ['completion', 'tools'], fam: 'qwen3moe', params: '30.5B', gb: 19, ctx: 262144 },
  'gemma3:12b': { caps: ['completion', 'vision'], fam: 'gemma3', params: '12.2B', gb: 8.1, ctx: 131072 },
  'deepseek-r1:8b': { caps: ['completion', 'thinking'], fam: 'qwen3', params: '8.2B', gb: 5.2, ctx: 131072 },
  'llama3.2:3b': { caps: ['completion', 'tools'], fam: 'llama', params: '3.2B', gb: 2.0, ctx: 131072 },
  'nomic-embed-text': { caps: ['embedding'], fam: 'nomic-bert', params: '137M', gb: 0.27, ctx: 2048 }
}

const INICIALES = ['qwen3.5:9b', 'qwen3:8b', 'gemma3:12b', 'deepseek-r1:8b', 'nomic-embed-text']

const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

function leerCuerpo(req) {
  return new Promise((ok) => {
    let d = ''
    req.on('data', (c) => (d += c))
    req.on('end', () => {
      try {
        ok(d ? JSON.parse(d) : {})
      } catch {
        ok({})
      }
    })
  })
}

function json(res, codigo, obj) {
  res.writeHead(codigo, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(obj))
}

function pedazos(texto) {
  return texto.match(/\S+\s*|\s+/g) ?? []
}

/** Decide qué hace el "modelo": texto o una llamada a herramienta. */
function guion(cuerpo) {
  const msgs = cuerpo.messages ?? []
  const sistema = msgs.find((m) => m.role === 'system')?.content ?? ''
  const herramientas = new Set((cuerpo.tools ?? []).map((t) => t.function.name))
  let ultimoUsuario = msgs.length - 1
  while (ultimoUsuario > 0 && msgs[ultimoUsuario].role !== 'user') ultimoUsuario--
  const pedido = String(msgs[ultimoUsuario]?.content ?? '')
  const p = pedido.toLowerCase()
  const resultados = msgs.slice(ultimoUsuario + 1).filter((m) => m.role === 'tool')
  const paso = resultados.length

  if (sistema.includes('You write prompts for an image diffusion model')) {
    return { texto: `A detailed illustration of ${pedido.replace(/\.$/, '')}, warm cinematic lighting, rich colors, soft depth of field, highly detailed, 4k` }
  }
  if (sistema.includes('Resume la conversación')) {
    return { texto: '- El usuario está probando Taller con el Ollama simulado.\n- Se crearon y leyeron archivos de prueba.\n- No queda nada pendiente.' }
  }

  const llamada = (name, args) => ({ llamada: { function: { name, arguments: args } } })
  const tiene = (n) => herramientas.has(n)

  if (herramientas.size) {
    if (/(crea|escribe|genera).*(archivo|script|programa)|hola mundo/.test(p) && tiene('write_file')) {
      const pasos = [
        () => tiene('todo_write') && llamada('todo_write', { todos: [
          { content: 'Crear hola.js', status: 'in_progress' },
          { content: 'Ejecutarlo para comprobar', status: 'pending' }
        ] }),
        () => llamada('write_file', { path: 'hola.js', content: "// Saludo de prueba creado por Taller\nconsole.log('¡Hola desde Taller!')\n" }),
        () => tiene('run_command') && llamada('run_command', { command: 'node hola.js' }),
        () => tiene('todo_write') && llamada('todo_write', { todos: [
          { content: 'Crear hola.js', status: 'completed' },
          { content: 'Ejecutarlo para comprobar', status: 'completed' }
        ] })
      ].map((f) => f()).filter(Boolean)
      if (paso < pasos.length) return pasos[paso]
      return { texto: 'Listo: creé **hola.js** y lo ejecuté; imprime `¡Hola desde Taller!`.' }
    }
    if (/(estructura|explica|proyecto|de qué trata)/.test(p) && tiene('list_files')) {
      if (paso === 0) return llamada('list_files', { pattern: '**/*' })
      if (paso === 1 && tiene('read_file')) {
        const lista = String(resultados[0].content).split('\n')
        const leer = lista.find((l) => /readme/i.test(l)) ?? lista.find((l) => /package\.json$/.test(l)) ?? lista[0]
        return llamada('read_file', { path: leer })
      }
      const archivos = String(resultados[0]?.content ?? '').split('\n').filter((l) => l && !l.startsWith('['))
      return {
        texto: `El proyecto tiene **${archivos.length} archivos**. Lo principal:\n\n${archivos.slice(0, 6).map((a) => `- \`${a}\``).join('\n')}\n\nLeí \`${resultados[1]?.tool_name === 'read_file' ? 'el archivo principal' : 'la lista'}\` y la idea general es clara. ¿Quieres que profundice en alguna parte?`
      }
    }
    if (/(busca|encuentra).*todo|todos?\b/.test(p) && tiene('grep')) {
      if (paso === 0) return llamada('grep', { pattern: 'TODO|FIXME' })
      const hallazgos = String(resultados[0].content).split('\n').filter((l) => l.includes(':'))
      return { texto: hallazgos.length ? `Encontré ${hallazgos.length} pendientes:\n\n| Archivo | Nota |\n|---|---|\n${hallazgos.slice(0, 8).map((h) => { const [a, l, ...t] = h.split(':'); return `| \`${a}:${l}\` | ${t.join(':').trim()} |` }).join('\n')}` : 'No hay TODOs ni FIXMEs en la carpeta.' }
    }
    if (/(dibuja|imagen|ilustra)/.test(p) && tiene('generate_image')) {
      if (paso === 0) return llamada('generate_image', { prompt: 'a cozy woodworking workshop at sunset, watercolor style' })
      return { texto: 'Aquí está la imagen. La guardé en `taller-salidas`.' }
    }
    if (/(borra|elimina)/.test(p) && tiene('run_command')) {
      if (paso === 0) return llamada('run_command', { command: process.platform === 'win32' ? 'Remove-Item hola.js' : 'rm hola.js' })
      return { texto: 'Hecho.' }
    }
    if (/(lee|abre|muestra).*(\.\w+)/.test(p) && tiene('read_file')) {
      const ruta = /([\w./\\-]+\.\w+)/.exec(pedido)?.[1]
      if (paso === 0) return llamada('read_file', { path: ruta })
      return { texto: `Este es el contenido de \`${ruta}\`, resumido: el archivo tiene ${String(resultados[0].content).split('\n').length} líneas.` }
    }
  }

  const imagenes = msgs[ultimoUsuario]?.images?.length ?? 0
  if (imagenes) {
    return { texto: `Veo ${imagenes === 1 ? 'una imagen' : `${imagenes} imágenes`}. Es una respuesta simulada: el modelo real describiría lo que hay en ella.` }
  }
  return {
    texto: `Esta es una respuesta **simulada** de \`${cuerpo.model}\` para que pruebes la interfaz sin GPU.\n\nMe preguntaste: _${pedido.slice(0, 120)}_\n\n| Función | ¿Activa? |\n|---|---|\n| Herramientas | ${herramientas.size ? 'sí' : 'no'} |\n| Pensar | ${cuerpo.think ? 'sí' : 'no'} |\n\n\`\`\`js\nconsole.log('hola desde el simulador')\n\`\`\``
  }
}

export function crearOllamaSimulado({ vacio = false, demora = 12 } = {}) {
  const modelos = new Map((vacio ? [] : INICIALES).map((n) => [n, CONOCIDOS[n]]))

  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x')
    const ruta = url.pathname

    if (ruta === '/' || ruta === '/api/version') {
      return ruta === '/' ? res.end('Ollama is running') : json(res, 200, { version: '0.13.0-simulado' })
    }
    if (ruta === '/api/tags') {
      return json(res, 200, {
        models: [...modelos].map(([name, m]) => ({
          name,
          model: name,
          size: Math.round(m.gb * 1e9),
          digest: semilla(name).toString(16),
          modified_at: new Date().toISOString(),
          details: { family: m.fam, parameter_size: m.params, quantization_level: 'Q4_K_M' }
        }))
      })
    }
    if (ruta === '/api/ps') return json(res, 200, { models: [] })

    const cuerpo = await leerCuerpo(req)

    if (ruta === '/api/show') {
      const m = modelos.get(cuerpo.model)
      if (!m) return json(res, 404, { error: `model '${cuerpo.model}' not found` })
      return json(res, 200, { capabilities: m.caps, details: { family: m.fam }, model_info: { [`${m.fam}.context_length`]: m.ctx } })
    }
    if (ruta === '/api/delete') {
      modelos.delete(cuerpo.model)
      return json(res, 200, {})
    }
    if (ruta === '/api/pull') {
      const nombre = String(cuerpo.model ?? cuerpo.name)
      const info = CONOCIDOS[nombre] ?? { caps: ['completion'], fam: nombre.split(':')[0], params: '?', gb: 3, ctx: 8192 }
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
      const linea = (o) => res.write(JSON.stringify(o) + '\n')
      linea({ status: 'pulling manifest' })
      const total = Math.round(info.gb * 1e9)
      for (let i = 1; i <= 20; i++) {
        if (res.destroyed) return
        await esperar(120)
        linea({ status: `pulling ${semilla(nombre).toString(16).slice(0, 12)}`, digest: 'sha256:simulado', total, completed: Math.round((total * i) / 20) })
      }
      linea({ status: 'verifying sha256 digest' })
      linea({ status: 'writing manifest' })
      modelos.set(nombre, info)
      linea({ status: 'success' })
      return res.end()
    }
    if (ruta === '/api/embed') {
      const entradas = Array.isArray(cuerpo.input) ? cuerpo.input : [cuerpo.input]
      const vec = (t) => {
        const v = new Array(64).fill(0)
        for (const w of String(t).toLowerCase().split(/\W+/).filter(Boolean)) v[semilla(w) % 64] += 1
        return v
      }
      return json(res, 200, { model: cuerpo.model, embeddings: entradas.map(vec) })
    }
    if (ruta === '/api/chat') {
      const m = modelos.get(cuerpo.model)
      if (!m) return json(res, 404, { error: `model '${cuerpo.model}' not found, try pulling it first` })
      if (cuerpo.tools?.length && !m.caps.includes('tools')) return json(res, 400, { error: `registry.ollama.ai/library/${cuerpo.model} does not support tools` })
      if (cuerpo.think !== undefined && !m.caps.includes('thinking')) return json(res, 400, { error: `"${cuerpo.model}" does not support thinking` })

      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
      const linea = (o) => res.write(JSON.stringify({ model: cuerpo.model, created_at: new Date().toISOString(), ...o }) + '\n')
      const g = guion(cuerpo)
      if (cuerpo.think) {
        for (const p of pedazos(g.llamada ? `Para esto me conviene usar ${g.llamada.function.name}.` : 'Ordeno la respuesta antes de escribirla.')) {
          linea({ message: { role: 'assistant', content: '', thinking: p }, done: false })
          await esperar(demora)
        }
      }
      if (g.llamada) {
        linea({ message: { role: 'assistant', content: '', tool_calls: [g.llamada] }, done: false })
      } else {
        for (const p of pedazos(g.texto)) {
          if (res.destroyed) return
          linea({ message: { role: 'assistant', content: p }, done: false })
          await esperar(demora)
        }
      }
      const prompt = Math.round(JSON.stringify(cuerpo.messages).length / 4)
      linea({ message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: prompt, eval_count: 40 })
      return res.end()
    }
    json(res, 404, { error: 'not found' })
  })
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const arg = (n, d) => {
    const i = process.argv.indexOf(n)
    return i >= 0 ? process.argv[i + 1] : d
  }
  const puerto = Number(arg('--puerto', 11434))
  crearOllamaSimulado({ vacio: process.argv.includes('--vacio') })
    .on('error', (e) => {
      console.error(e.code === 'EADDRINUSE' ? `El puerto ${puerto} está ocupado (¿ya corre Ollama de verdad?). Usa --puerto.` : e.message)
      process.exit(1)
    })
    .listen(puerto, '127.0.0.1', () => console.log(`Ollama simulado en http://127.0.0.1:${puerto}`))
}
