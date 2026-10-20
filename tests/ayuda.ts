import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Entorno, EstadoComfy, ModeloLocal } from '@shared/tipos'

export async function escuchar(s: Server): Promise<string> {
  await new Promise<void>((ok) => s.listen(0, '127.0.0.1', ok))
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`
}

export function cerrar(s: Server): Promise<void> {
  s.closeAllConnections()
  return new Promise((ok) => s.close(() => ok()))
}

export const COMFY_APAGADO: EstadoComfy = {
  conectado: false,
  url: 'http://127.0.0.1:8188',
  checkpointsImagen: [],
  checkpoints3d: [],
  nodos3d: false,
  faltan: [],
  mensaje: ''
}

export function entorno(modelos: ModeloLocal[], comfy: Partial<EstadoComfy> = {}): Entorno {
  return {
    ollama: { estado: 'conectado', url: 'http://127.0.0.1:11434', version: '0.13.0', modelos },
    comfy: { ...COMFY_APAGADO, ...comfy },
    hardware: { ramGb: 32, vramGb: 12, gpu: 'RTX 5070', so: 'win32' },
    mcp: []
  }
}

export function modelo(nombre: string, capacidades: ModeloLocal['capacidades']): ModeloLocal {
  return { nombre, capacidades, tamano: 5e9 }
}
