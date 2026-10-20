import type { Ajustes, Archivo, EstadoComfy, Tarea } from '@shared/tipos'
import type { Comfy } from '../comfy'
import type { Ollama } from '../ollama'

export interface CtxHerramienta {
  carpeta: string
  /** Dónde se guardan imágenes y modelos 3D. */
  salidas: string
  signal: AbortSignal
  ollama: Ollama
  modelo: string
  ajustes: Ajustes
  comfy?: Comfy
  estadoComfy?: EstadoComfy
  ponerTareas(t: Tarea[]): void
  subagente(prompt: string, descripcion: string): Promise<string>
  progreso(etapa: string): void
}

export interface Resultado {
  texto: string
  archivos?: Archivo[]
  error?: boolean
}

/**
 * - lectura: no cambia nada (se pregunta solo si sale de la carpeta)
 * - edicion: escribe archivos de la carpeta
 * - comando / red / mcp: siempre se pregunta salvo en «todo permitido»
 * - generacion / interna: crean archivos nuevos en la carpeta de salidas o solo cambian el estado de Taller
 */
export type Clase = 'lectura' | 'edicion' | 'comando' | 'red' | 'mcp' | 'generacion' | 'interna'

export interface Herramienta {
  nombre: string
  descripcion: string
  parametros: Record<string, unknown>
  clase: Clase
  resumen(args: Record<string, any>): string
  /** Vista previa para el aviso de permiso (por ejemplo, el diff). */
  detalle?(args: Record<string, any>, ctx: CtxHerramienta): Promise<string | undefined>
  ejecutar(args: Record<string, any>, ctx: CtxHerramienta): Promise<Resultado>
}
