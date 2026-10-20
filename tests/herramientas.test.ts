import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { diffSimple, HERRAMIENTAS_BASE, htmlATexto } from '../src/main/agente/herramientas'
import { extraerLlamadas, separarPensamiento } from '../src/main/agente/llamadas'
import { dentroDe, permitidaEnModo, requierePermiso } from '../src/main/agente/permisos'
import type { CtxHerramienta } from '../src/main/agente/tipos'

const h = (n: string) => HERRAMIENTAS_BASE.find((x) => x.nombre === n)!
let dir = ''
let ctx: CtxHerramienta

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'taller-'))
  await writeFile(join(dir, 'app.ts'), 'const a = 1\n// TODO: probar\nconst b = 2\nconst b2 = 2\n')
  ctx = {
    carpeta: dir,
    salidas: join(dir, 'taller-salidas'),
    signal: new AbortController().signal,
    ollama: null as never,
    modelo: 'x',
    ajustes: null as never,
    ponerTareas: () => undefined,
    subagente: async () => '',
    progreso: () => undefined
  }
})

afterAll(() => rm(dir, { recursive: true, force: true }))

describe('herramientas de archivos', () => {
  it('lee con números de línea', async () => {
    const r = await h('read_file').ejecutar({ path: 'app.ts' }, ctx)
    expect(r.texto.split('\n')[1]).toBe('2\t// TODO: probar')
  })

  it('edita solo si el fragmento es único', async () => {
    const ambiguo = await h('edit_file').ejecutar({ path: 'app.ts', old_string: '= 2', new_string: '= 3' }, ctx)
    expect(ambiguo.error).toBe(true)
    expect(ambiguo.texto).toContain('2 veces')
    const ok = await h('edit_file').ejecutar({ path: 'app.ts', old_string: 'const b = 2', new_string: 'const b = 20' }, ctx)
    expect(ok.error).toBeUndefined()
    expect(await readFile(join(dir, 'app.ts'), 'utf8')).toContain('const b = 20\nconst b2 = 2')
  })

  it('no confunde $ del reemplazo con patrones', async () => {
    await h('edit_file').ejecutar({ path: 'app.ts', old_string: 'const a = 1', new_string: "const a = '$&$1'" }, ctx)
    expect(await readFile(join(dir, 'app.ts'), 'utf8')).toContain("const a = '$&$1'")
  })

  it('escribe creando carpetas y lista con glob', async () => {
    await h('write_file').ejecutar({ path: 'src/nuevo/util.ts', content: 'export const x = 1\n' }, ctx)
    const r = await h('list_files').ejecutar({ pattern: '**/*.ts' }, ctx)
    expect(r.texto.split('\n')).toEqual(['app.ts', 'src/nuevo/util.ts'])
  })

  it('grep devuelve ruta:línea', async () => {
    const r = await h('grep').ejecutar({ pattern: 'TODO' }, ctx)
    expect(r.texto).toBe('app.ts:2: // TODO: probar')
  })

  it('run_command devuelve salida y código', async () => {
    const r = await h('run_command').ejecutar({ command: 'node -e "console.log(40+2)"' }, ctx)
    expect(r.texto).toContain('42')
    expect(r.texto).toContain('código de salida 0')
    const mal = await h('run_command').ejecutar({ command: 'node -e "process.exit(3)"' }, ctx)
    expect(mal.error).toBe(true)
    expect(mal.texto).toContain('código de salida 3')
  })

  it.runIf(process.platform === 'win32')('PowerShell devuelve las tildes bien', async () => {
    const r = await h('run_command').ejecutar({ command: "Write-Output 'canción ñandú'" }, ctx)
    expect(r.texto).toContain('canción ñandú')
    const fallo = await h('run_command').ejecutar({ command: 'Get-Item no-existe.txt' }, ctx)
    expect(fallo.error).toBe(true)
  })

  it('el diff marca solo lo que cambia', () => {
    expect(diffSimple('a\nb\nc', 'a\nB\nc')).toBe('@@ línea 2 @@\n- b\n+ B')
  })

  it('pasa HTML a texto', () => {
    expect(htmlATexto('<html><head><title>x</title></head><body><script>1</script><p>Hola&nbsp;<b>mundo</b></p></body></html>')).toBe('Hola mundo')
  })
})

describe('permisos', () => {
  const permitidas = new Set<string>()
  it('leer dentro de la carpeta no pregunta; fuera sí', () => {
    expect(requierePermiso(h('read_file'), { path: 'app.ts' }, 'preguntar', dir, permitidas)).toBe(false)
    expect(requierePermiso(h('read_file'), { path: '../otro/secreto.txt' }, 'preguntar', dir, permitidas)).toBe(true)
    expect(dentroDe(dir, join(dir, 'a', 'b'))).toBe(true)
  })

  it('auto-editar no pregunta para editar, pero sí para comandos', () => {
    expect(requierePermiso(h('edit_file'), { path: 'app.ts' }, 'editar', dir, permitidas)).toBe(false)
    expect(requierePermiso(h('edit_file'), { path: 'app.ts' }, 'preguntar', dir, permitidas)).toBe(true)
    expect(requierePermiso(h('run_command'), { command: 'ls' }, 'editar', dir, permitidas)).toBe(true)
    expect(requierePermiso(h('run_command'), { command: 'ls' }, 'todo', dir, permitidas)).toBe(false)
  })

  it('«permitir siempre» aplica a esa herramienta', () => {
    expect(requierePermiso(h('run_command'), { command: 'ls' }, 'preguntar', dir, new Set(['run_command']))).toBe(false)
  })

  it('el modo plan solo deja herramientas que miran', () => {
    const plan = HERRAMIENTAS_BASE.filter((x) => permitidaEnModo(x, 'plan')).map((x) => x.nombre)
    expect(plan).toEqual(['read_file', 'list_files', 'grep', 'todo_write', 'task'])
  })
})

describe('rescate de llamadas escritas como texto', () => {
  const nombres = ['read_file', 'grep']
  it('formato <tool_call>', () => {
    const r = extraerLlamadas('Voy a leerlo.\n<tool_call>\n{"name": "read_file", "arguments": {"path": "a.ts"}}\n</tool_call>', nombres)
    expect(r.llamadas).toEqual([{ function: { name: 'read_file', arguments: { path: 'a.ts' } } }])
    expect(r.resto).toBe('Voy a leerlo.')
  })

  it('bloque ```json y argumentos como texto', () => {
    const r = extraerLlamadas('```json\n{"name":"grep","arguments":"{\\"pattern\\":\\"x\\"}"}\n```', nombres)
    expect(r.llamadas[0].function.arguments).toEqual({ pattern: 'x' })
  })

  it('no inventa llamadas con herramientas desconocidas', () => {
    expect(extraerLlamadas('{"name": "borrar_todo", "arguments": {}}', nombres).llamadas).toEqual([])
    expect(extraerLlamadas('Un JSON cualquiera: {"a": 1}', nombres).llamadas).toEqual([])
  })

  it('separa <think> del texto', () => {
    expect(separarPensamiento('<think>hmm</think>\nRespuesta')).toEqual({ texto: 'Respuesta', pensamiento: 'hmm' })
  })
})
