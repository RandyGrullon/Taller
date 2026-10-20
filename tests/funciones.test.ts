import { describe, expect, it } from 'vitest'
import { disponibilidad, modeloInicial, modoPosible } from '@shared/funciones'
import { entorno, modelo } from './ayuda'

const qwen = modelo('qwen3:8b', ['completion', 'tools', 'thinking'])
const gemma = modelo('gemma3:12b', ['completion', 'vision'])
const vl = modelo('qwen3-vl:8b', ['completion', 'tools', 'vision', 'thinking'])
const nomic = modelo('nomic-embed-text', ['embedding'])

describe('disponibilidad por modelo', () => {
  it('bloquea el agente a un modelo sin herramientas y sugiere los que sí tienen', () => {
    const e = entorno([qwen, gemma, vl])
    const d = disponibilidad('agente', gemma, e)
    expect(d.activa).toBe(false)
    expect(d.motivo).toContain('no sabe usar herramientas')
    expect(d.alternativas).toEqual(['qwen3:8b', 'qwen3-vl:8b'])
  })

  it('bloquea la visión y, sin alternativas instaladas, sugiere un modelo del catálogo', () => {
    const d = disponibilidad('vision', qwen, entorno([qwen]))
    expect(d.activa).toBe(false)
    expect(d.alternativas).toEqual([])
    expect(d.sugerencia).toBe('qwen3.5:9b')
  })

  it('un modelo de embeddings no conversa', () => {
    const d = disponibilidad('chat', nomic, entorno([nomic]))
    expect(d.activa).toBe(false)
    expect(d.motivo).toContain('embeddings')
  })

  it('«Buscar en documentos» pide herramientas y un modelo de embeddings', () => {
    expect(disponibilidad('documentos', qwen, entorno([qwen])).motivo).toContain('nomic-embed-text')
    expect(disponibilidad('documentos', qwen, entorno([qwen, nomic])).activa).toBe(true)
    expect(disponibilidad('documentos', gemma, entorno([gemma, nomic])).activa).toBe(false)
  })

  it('imagen y 3D dependen de ComfyUI, no del modelo', () => {
    const sinComfy = entorno([qwen])
    expect(disponibilidad('imagen', qwen, sinComfy).motivo).toContain('ComfyUI no responde')
    const soloImagen = entorno([qwen], { conectado: true, checkpointsImagen: ['sdxl.safetensors'], faltan: ['SaveGLB'] })
    expect(disponibilidad('imagen', undefined, soloImagen).activa).toBe(true)
    expect(disponibilidad('modelo3d', undefined, soloImagen).motivo).toContain('nodos de Hunyuan3D')
    const completo = entorno([qwen], { conectado: true, checkpointsImagen: ['sdxl'], checkpoints3d: ['hunyuan_3d_v2.1.safetensors'], nodos3d: true })
    expect(disponibilidad('modelo3d', gemma, completo).activa).toBe(true)
  })

  it('sin Ollama todo lo del modelo queda bloqueado', () => {
    const e = entorno([])
    e.ollama.estado = 'no-instalado'
    expect(disponibilidad('chat', undefined, e).motivo).toBe('Ollama no está corriendo.')
  })
})

describe('modo y modelo iniciales', () => {
  it('prefiere un modelo con herramientas', () => {
    expect(modeloInicial(entorno([gemma, nomic, qwen]))).toBe('qwen3:8b')
    expect(modeloInicial(entorno([gemma, qwen]), 'gemma3:12b')).toBe('gemma3:12b')
    expect(modeloInicial(entorno([nomic]))).toBeUndefined()
  })

  it('cae a chat cuando el modelo no puede ser agente', () => {
    const e = entorno([gemma])
    expect(modoPosible('agente', gemma, e)).toBe('chat')
    expect(modoPosible('agente', qwen, entorno([qwen]))).toBe('agente')
  })
})
