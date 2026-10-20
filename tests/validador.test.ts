import type { Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Prueba } from '@shared/tipos'
import { crearComfySimulado } from '../scripts/comfyui-simulado.mjs'
import { crearOllamaSimulado } from '../scripts/ollama-simulado.mjs'
import { ajustesPorDefecto } from '../src/main/almacen'
import { Comfy } from '../src/main/comfy'
import { Ollama } from '../src/main/ollama'
import { validar, type DepsValidador } from '../src/main/validador'
import { cerrar, escuchar } from './ayuda'

let ollama: Server
let ollamaVacio: Server
let comfy: Server
const url = { ollama: '', vacio: '', comfy: '' }
let datos = ''

beforeAll(async () => {
  ollama = crearOllamaSimulado({ demora: 0 })
  ollamaVacio = crearOllamaSimulado({ vacio: true })
  comfy = crearComfySimulado({ paso: 1 })
  url.ollama = await escuchar(ollama)
  url.vacio = await escuchar(ollamaVacio)
  url.comfy = await escuchar(comfy)
  datos = await mkdtemp(join(tmpdir(), 'taller-datos-'))
})

afterAll(async () => {
  await Promise.all([cerrar(ollama), cerrar(ollamaVacio), cerrar(comfy)])
  await rm(datos, { recursive: true, force: true })
})

function deps(ollamaUrl: string, comfyUrl: string, cambios: Prueba[][] = []): DepsValidador {
  return {
    ollama: new Ollama(ollamaUrl),
    comfy: new Comfy(comfyUrl),
    ajustes: ajustesPorDefecto(datos),
    version: '0.0.0-prueba',
    mcp: async () => [],
    dirDatos: datos,
    probarProtocolo: async () => true,
    // Sin salir a internet en las pruebas
    urlInternet: ollamaUrl,
    signal: new AbortController().signal,
    alCambiar: (p) => cambios.push(p)
  }
}

const estados = (pruebas: Prueba[]) => Object.fromEntries(pruebas.map((p) => [p.id, p.estado]))

describe('validador', () => {
  it('con todo listo, cada prueba pasa y el informe lo cuenta', async () => {
    const cambios: Prueba[][] = []
    const r = await validar('qwen3.5:9b', deps(url.ollama, url.comfy, cambios))
    const e = estados(r.pruebas)
    expect(e).toMatchObject({
      sistema: 'ok',
      datos: 'ok',
      archivos: 'ok',
      terminal: 'ok',
      visor: 'ok',
      internet: 'ok',
      ollama: 'ok',
      modelos: 'ok',
      chat: 'ok',
      herramientas: 'ok',
      agente: 'ok',
      pensar: 'ok',
      vision: 'ok',
      embeddings: 'ok',
      comfy: 'ok',
      imagen: 'ok',
      '3d': 'ok',
      mcp: 'omitida'
    })
    // La GPU depende de la máquina: bien con NVIDIA, para revisar sin ella
    expect(['ok', 'aviso']).toContain(e.gpu)
    // El avance se va contando: primero todo en espera
    expect(cambios[0].every((p) => p.estado === 'pendiente')).toBe(true)
    const r2 = r.pruebas.find((p) => p.id === 'herramientas')!
    expect(r2.detalle).toContain('qwen3.5:9b pidió sumar(1234, 4321)')
    expect(r.pruebas.find((p) => p.id === 'chat')!.detalle).toMatch(/tokens\/s/)
    expect(r.markdown).toContain('# Informe del validador de Taller')
    expect(r.markdown).toContain('| ✅ | Agente completo |')
    expect(r.markdown).toContain('## Lo que respondieron')
    await rm(r.carpeta, { recursive: true, force: true })
  })

  it('elige solo un modelo que sirva para cada prueba', async () => {
    // gemma3 no usa herramientas ni razona: esas pruebas usan otro modelo instalado
    const r = await validar('gemma3:12b', deps(url.ollama, url.comfy))
    const p = (id: string) => r.pruebas.find((x) => x.id === id)!
    expect(p('chat').detalle).toContain('gemma3:12b')
    expect(p('vision').detalle).toContain('gemma3:12b')
    expect(p('herramientas').detalle).not.toContain('gemma3')
    expect(p('herramientas').estado).toBe('ok')
    await rm(r.carpeta, { recursive: true, force: true })
  })

  it('sin Ollama ni ComfyUI igual revisa la app y explica lo que falta', async () => {
    const r = await validar(undefined, deps('http://127.0.0.1:9', 'http://127.0.0.1:9'))
    const e = estados(r.pruebas)
    expect(e).toMatchObject({ datos: 'ok', archivos: 'ok', terminal: 'ok', ollama: 'error', chat: 'omitida', agente: 'omitida', comfy: 'aviso', imagen: 'omitida' })
    expect(r.pruebas.find((p) => p.id === 'chat')!.detalle).toBe('Ollama no está corriendo.')
    await rm(r.carpeta, { recursive: true, force: true })
  })

  it('sin modelos dice cuál falta', async () => {
    const r = await validar(undefined, deps(url.vacio, 'http://127.0.0.1:9'))
    const p = (id: string) => r.pruebas.find((x) => x.id === id)!
    expect(p('modelos').estado).toBe('aviso')
    expect(p('herramientas').detalle).toContain('Herramientas')
    expect(p('embeddings').detalle).toContain('nomic-embed-text')
    await rm(r.carpeta, { recursive: true, force: true })
  })

  it('al detenerlo, lo que falta queda omitido', async () => {
    const ctl = new AbortController()
    ctl.abort()
    const r = await validar(undefined, { ...deps(url.ollama, url.comfy), signal: ctl.signal })
    expect(r.pruebas.every((p) => p.estado === 'omitida')).toBe(true)
    await rm(r.carpeta, { recursive: true, force: true })
  })
})
