import { isAbsolute, relative, resolve } from 'node:path'
import type { ModoPermiso } from '@shared/tipos'
import type { Herramienta } from './tipos'

export function resolverRuta(carpeta: string, ruta: string): string {
  return resolve(carpeta, ruta)
}

export function dentroDe(carpeta: string, ruta: string): boolean {
  const rel = relative(resolve(carpeta), resolverRuta(carpeta, ruta))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** ¿Hay que preguntarle al usuario antes de correr esta llamada? */
export function requierePermiso(
  h: Herramienta,
  args: Record<string, unknown>,
  modo: ModoPermiso,
  carpeta: string,
  permitidas: Set<string>
): boolean {
  if (modo === 'todo' || permitidas.has(h.nombre)) return false
  const rutas = ['path', 'image_path'].map((k) => args[k]).filter((v): v is string => typeof v === 'string' && v !== '')
  const fuera = rutas.some((r) => !dentroDe(carpeta, r))
  switch (h.clase) {
    case 'lectura':
      return fuera
    case 'interna':
    case 'generacion':
      return fuera
    case 'edicion':
      return modo !== 'editar' || fuera
    default:
      return true
  }
}

/** En modo plan el agente solo mira: nada que escriba, ejecute o salga a la red. */
export function permitidaEnModo(h: Herramienta, modo: ModoPermiso): boolean {
  return modo !== 'plan' || h.clase === 'lectura' || h.clase === 'interna'
}
