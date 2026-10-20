// Ajustes y conversaciones en JSON dentro de la carpeta de datos de la app.
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Ajustes, Conversacion, ResumenConversacion } from '@shared/tipos'
import type { Mensaje } from './ollama'

export function ajustesPorDefecto(carpetaSalidas: string): Ajustes {
  return {
    ollamaUrl: 'http://127.0.0.1:11434',
    comfyUrl: 'http://127.0.0.1:8188',
    contexto: 16384,
    permisos: 'preguntar',
    tema: 'sistema',
    carpetaSalidas,
    maxPasos: 40,
    mejorarPrompt: true,
    mcpServers: {}
  }
}

export interface Guardado {
  conversacion: Conversacion
  historial: Mensaje[]
}

async function escribirSeguro(ruta: string, datos: string): Promise<void> {
  const tmp = `${ruta}.${process.pid}.tmp`
  await writeFile(tmp, datos, 'utf8')
  await rename(tmp, ruta)
}

export class Almacen {
  private dirConversaciones: string

  constructor(
    public dir: string,
    private porDefecto: Ajustes
  ) {
    this.dirConversaciones = join(dir, 'conversaciones')
  }

  async leerAjustes(): Promise<Ajustes> {
    const texto = await readFile(join(this.dir, 'ajustes.json'), 'utf8').catch(() => null)
    if (!texto) return { ...this.porDefecto }
    try {
      return { ...this.porDefecto, ...JSON.parse(texto) }
    } catch {
      return { ...this.porDefecto }
    }
  }

  async guardarAjustes(a: Ajustes): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    await escribirSeguro(join(this.dir, 'ajustes.json'), JSON.stringify(a, null, 2))
  }

  async listar(): Promise<ResumenConversacion[]> {
    const archivos = await readdir(this.dirConversaciones).catch(() => [] as string[])
    const resumenes = await Promise.all(
      archivos
        .filter((a) => a.endsWith('.json'))
        .map(async (a): Promise<ResumenConversacion | null> => {
          const g = await this.leer(a.slice(0, -5))
          if (!g) return null
          const { id, titulo, actualizada, modelo, carpeta } = g.conversacion
          return { id, titulo, actualizada, modelo, carpeta }
        })
    )
    return resumenes.filter((r) => r !== null).sort((a, b) => b.actualizada - a.actualizada)
  }

  async leer(id: string): Promise<Guardado | null> {
    if (!/^[\w-]+$/.test(id)) return null
    const texto = await readFile(join(this.dirConversaciones, `${id}.json`), 'utf8').catch(() => null)
    if (!texto) return null
    try {
      return JSON.parse(texto) as Guardado
    } catch {
      return null
    }
  }

  async guardar(g: Guardado): Promise<void> {
    await mkdir(this.dirConversaciones, { recursive: true })
    // Las imágenes van como archivo (`_imagenes`); el base64 no se guarda
    const historial = g.historial.map(({ images: _sinImagenes, ...m }) => m)
    const conversacion = { ...g.conversacion, ocupada: false }
    await escribirSeguro(join(this.dirConversaciones, `${g.conversacion.id}.json`), JSON.stringify({ conversacion, historial }))
  }

  async borrar(id: string): Promise<void> {
    if (!/^[\w-]+$/.test(id)) return
    await rm(join(this.dirConversaciones, `${id}.json`), { force: true })
  }
}
