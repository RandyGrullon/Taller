import type { Server } from 'node:http'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { aplicar } from '@shared/conversacion'
import type { Conversacion, Evento, ModoPermiso, RespuestaPermiso } from '@shared/tipos'
import { crearOllamaSimulado } from '../scripts/ollama-simulado.mjs'
import { correrAgente, type SolicitudPermiso } from '../src/main/agente/bucle'
import { HERRAMIENTAS_BASE } from '../src/main/agente/herramientas'
import { permitidaEnModo } from '../src/main/agente/permisos'
import { ajustesPorDefecto } from '../src/main/almacen'
import { detectarOllama } from '../src/main/deteccion'
import { Ollama, type Mensaje } from '../src/main/ollama'
import { cerrar, escuchar } from './ayuda'

let servidor: Server
let url = ''
let dir = ''

beforeAll(async () => {
  servidor = crearOllamaSimulado({ demora: 0 })
  url = await escuchar(servidor)
  dir = await mkdtemp(join(tmpdir(), 'taller-agente-'))
})

afterAll(async () => {
  await cerrar(servidor)
  await rm(dir, { recursive: true, force: true })
})

function correr(o: { modelo: string; pedido: string; modo?: ModoPermiso; responder?: (s: SolicitudPermiso) => RespuestaPermiso; herramientas?: boolean }) {
  const ollama = new Ollama(url)
  const historial: Mensaje[] = [{ role: 'user', content: o.pedido }]
  const eventos: Evento[] = []
  const permisos: SolicitudPermiso[] = []
  const signal = new AbortController().signal
  const modo = o.modo ?? 'todo'
  const promesa = correrAgente({
    ollama,
    modelo: o.modelo,
    capacidades: o.modelo === 'gemma3:12b' ? ['completion', 'vision'] : ['completion', 'tools', 'thinking'],
    sistema: 'prueba',
    historial,
    herramientas: o.herramientas === false ? [] : HERRAMIENTAS_BASE.filter((h) => permitidaEnModo(h, modo)),
    modoPermiso: modo,
    pensar: true,
    contexto: 8192,
    maxPasos: 10,
    signal,
    permitidas: new Set(),
    ctx: {
      carpeta: dir,
      salidas: join(dir, 'taller-salidas'),
      signal,
      ollama,
      modelo: o.modelo,
      ajustes: ajustesPorDefecto(dir),
      ponerTareas: () => undefined,
      subagente: async () => ''
    },
    emitir: (e) => eventos.push(e),
    pedirPermiso: async (s) => {
      permisos.push(s)
      return o.responder?.(s) ?? 'si'
    }
  })
  return { promesa, eventos, permisos, historial }
}

function conversacion(eventos: Evento[]): Conversacion {
  const vacia: Conversacion = { id: 'c', titulo: '', creada: 0, actualizada: 0, modo: 'agente', permisos: 'todo', items: [], tareas: [], ocupada: false }
  return eventos.reduce(aplicar, vacia)
}

describe('detección', () => {
  it('lista los modelos con lo que puede hacer cada uno', async () => {
    const e = await detectarOllama(url)
    expect(e.estado).toBe('conectado')
    const qwen = e.modelos.find((m) => m.nombre === 'qwen3:8b')!
    expect(qwen.capacidades).toEqual(['completion', 'tools', 'thinking'])
    expect(qwen.contexto).toBe(40960)
    expect(e.modelos.find((m) => m.nombre === 'gemma3:12b')!.capacidades).not.toContain('tools')
  })

  it('sin Ollama dice si está instalado o no', async () => {
    const e = await detectarOllama('http://127.0.0.1:9')
    expect(['apagado', 'no-instalado']).toContain(e.estado)
    expect(e.modelos).toEqual([])
  })

  it('descarga un modelo con progreso y aparece en la lista', async () => {
    const ollama = new Ollama(url)
    const estados: string[] = []
    for await (const p of ollama.descargar('llama3.2:3b')) estados.push(p.status)
    expect(estados.at(-1)).toBe('success')
    expect((await ollama.modelos()).map((m) => m.nombre)).toContain('llama3.2:3b')
  })
})

describe('bucle del agente', () => {
  it('crea un archivo, lo ejecuta y responde', async () => {
    const { promesa, eventos, historial } = correr({ modelo: 'qwen3:8b', pedido: 'Crea un archivo hola mundo en JavaScript' })
    const final = await promesa
    expect(final).toContain('hola.js')
    expect(existsSync(join(dir, 'hola.js'))).toBe(true)
    const c = conversacion(eventos)
    const herramientas = c.items.filter((i) => i.tipo === 'herramienta')
    expect(herramientas.map((i) => i.tipo === 'herramienta' && i.nombre)).toEqual(['todo_write', 'write_file', 'run_command', 'todo_write'])
    expect(herramientas.every((i) => i.tipo === 'herramienta' && i.estado === 'ok')).toBe(true)
    const salida = historial.find((m) => m.role === 'tool' && m.tool_name === 'run_command')
    expect(salida?.content).toContain('¡Hola desde Taller!')
    expect(c.items.some((i) => i.tipo === 'asistente' && i.pensamiento)).toBe(true)
  })

  it('pide permiso para escribir y se detiene si el usuario dice que no', async () => {
    await rm(join(dir, 'hola.js'), { force: true })
    const { promesa, eventos, permisos } = correr({ modelo: 'qwen3:8b', pedido: 'Crea un archivo hola mundo', modo: 'preguntar', responder: () => 'no' })
    await promesa
    expect(permisos.map((p) => p.nombre)).toEqual(['write_file'])
    expect(permisos[0].detalle).toContain("+ console.log('¡Hola desde Taller!')")
    expect(existsSync(join(dir, 'hola.js'))).toBe(false)
    const c = conversacion(eventos)
    expect(c.items.find((i) => i.tipo === 'herramienta' && i.nombre === 'write_file')).toMatchObject({ estado: 'rechazada' })
    // El aviso de permiso desaparece al responder
    expect(c.items.some((i) => i.tipo === 'permiso')).toBe(false)
  })

  it('chat sin herramientas con un modelo que no las soporta', async () => {
    const { promesa, eventos } = correr({ modelo: 'gemma3:12b', pedido: '¿Qué es un JWT?', herramientas: false })
    const final = await promesa
    expect(final).toContain('simulada')
    expect(conversacion(eventos).items).toHaveLength(1)
  })

  it('traduce el error de Ollama cuando el modelo no usa herramientas', async () => {
    const { promesa } = correr({ modelo: 'gemma3:12b', pedido: 'Crea un archivo hola mundo' })
    await expect(promesa).rejects.toThrow('Este modelo no soporta herramientas')
  })
})
