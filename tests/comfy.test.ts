import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { crearComfySimulado } from '../scripts/comfyui-simulado.mjs'
import { Comfy, es3d, grafo3d, preset3d } from '../src/main/comfy'
import { inferirCapacidades, traducirError } from '../src/main/ollama'
import { cerrar, escuchar } from './ayuda'

let completo: Server
let sin3d: Server
let urlCompleto = ''
let urlSin3d = ''

beforeAll(async () => {
  completo = crearComfySimulado({ paso: 1 })
  sin3d = crearComfySimulado({ sin3d: true, paso: 1 })
  urlCompleto = await escuchar(completo)
  urlSin3d = await escuchar(sin3d)
})

afterAll(async () => {
  await cerrar(completo)
  await cerrar(sin3d)
})

describe('ComfyUI', () => {
  it('detecta GPU, checkpoints y nodos de Hunyuan3D', async () => {
    const e = await new Comfy(urlCompleto).estado()
    expect(e.conectado).toBe(true)
    expect(e.gpu).toBe('NVIDIA GeForce RTX 5070 (simulada)')
    expect(e.vramGb).toBe(12)
    expect(e.checkpoints3d).toEqual(['hunyuan_3d_v2.1.safetensors'])
    expect(e.checkpointsImagen).toContain('sd_xl_base_1.0.safetensors')
    expect(e.nodos3d).toBe(true)
  })

  it('avisa qué nodos faltan', async () => {
    const e = await new Comfy(urlSin3d).estado()
    expect(e.nodos3d).toBe(false)
    expect(e.faltan).toContain('SaveGLB')
  })

  it('apagado no rompe nada', async () => {
    const e = await new Comfy('http://127.0.0.1:9').estado()
    expect(e.conectado).toBe(false)
  })

  it('genera una imagen PNG y la convierte en GLB', async () => {
    const c = new Comfy(urlCompleto)
    const etapas: number[] = []
    const imagen = await c.textoAImagen({ prompt: 'a red apple', checkpoint: 'sd_xl_base_1.0.safetensors' }, (p) => etapas.push(p.fraccion))
    expect(imagen.subarray(1, 4).toString()).toBe('PNG')
    const modelo = await c.imagenA3d({ imagen, checkpoint: 'hunyuan_3d_v2.1.safetensors' }, (p) => etapas.push(p.fraccion))
    expect(modelo.subarray(0, 4).toString()).toBe('glTF')
    expect(etapas.length).toBeGreaterThan(0)
  })

  it('traduce el rechazo del flujo', async () => {
    const c = new Comfy(urlCompleto)
    await expect(c.textoAImagen({ prompt: 'x', checkpoint: 'no-existe.safetensors' }, () => undefined)).rejects.toThrow('ComfyUI rechazó el flujo')
  })

  it('usa los ajustes de la plantilla oficial según el checkpoint', () => {
    expect(preset3d('hunyuan_3d_v2.1.safetensors').steps).toBe(30)
    expect(preset3d('hunyuan3d-dit-v2_fp16.safetensors').cfg).toBe(8)
    expect(es3d('hunyuan3d-dit-v2-mini.safetensors')).toBe(true)
    expect(es3d('sd_xl_base_1.0.safetensors')).toBe(false)
    expect(grafo3d('a.png', 'hunyuan_3d_v2.1.safetensors', 7)['7'].inputs.seed).toBe(7)
  })
})

describe('Ollama', () => {
  it('deduce capacidades en versiones viejas sin «capabilities»', () => {
    const r = inferirCapacidades({
      template: '{{- if .Tools }}…{{ end }}',
      projector_info: {},
      model_info: { 'llama.context_length': 131072 }
    })
    expect(r.capacidades).toEqual(['completion', 'tools', 'vision'])
    expect(r.contexto).toBe(131072)
    expect(inferirCapacidades({ details: { family: 'nomic-bert' } }).capacidades).toEqual(['embedding'])
  })

  it('traduce los errores típicos', () => {
    expect(traducirError('registry.ollama.ai/library/gemma3:12b does not support tools')).toContain('no soporta herramientas')
    expect(traducirError('model requires more system memory (insufficient memory)')).toContain('No alcanza la memoria')
  })
})
