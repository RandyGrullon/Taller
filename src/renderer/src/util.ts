import type { ResumenConversacion } from '@shared/tipos'

export const api = window.taller

export function gb(bytes: number): string {
  if (!bytes) return '—'
  const g = bytes / 1e9
  return g >= 1 ? `${g.toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`
}

export function nombreCarpeta(ruta?: string): string {
  if (!ruta) return ''
  return ruta.split(/[\\/]/).filter(Boolean).pop() ?? ruta
}

export function agrupar(lista: ResumenConversacion[]): { titulo: string; items: ResumenConversacion[] }[] {
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  const ayer = hoy.getTime() - 86_400_000
  const semana = hoy.getTime() - 7 * 86_400_000
  const grupos: Record<string, ResumenConversacion[]> = { Hoy: [], Ayer: [], 'Esta semana': [], 'Antes': [] }
  for (const c of lista) {
    const t = c.actualizada
    const g = t >= hoy.getTime() ? 'Hoy' : t >= ayer ? 'Ayer' : t >= semana ? 'Esta semana' : 'Antes'
    grupos[g].push(c)
  }
  return Object.entries(grupos)
    .filter(([, items]) => items.length)
    .map(([titulo, items]) => ({ titulo, items }))
}

export function leerLocal<T>(clave: string, porDefecto: T): T {
  try {
    const v = localStorage.getItem(clave)
    return v === null ? porDefecto : (JSON.parse(v) as T)
  } catch {
    return porDefecto
  }
}

export function guardarLocal(clave: string, valor: unknown): void {
  try {
    localStorage.setItem(clave, JSON.stringify(valor))
  } catch {
    /* sin almacenamiento: no pasa nada */
  }
}

export function leerComoDataUrl(archivo: File): Promise<string> {
  return new Promise((ok, mal) => {
    const r = new FileReader()
    r.onload = () => ok(String(r.result))
    r.onerror = () => mal(r.error)
    r.readAsDataURL(archivo)
  })
}
