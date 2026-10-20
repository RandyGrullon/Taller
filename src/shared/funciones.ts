import { CATALOGO, cabe } from './catalogo'
import type { Capacidad, Entorno, ModeloLocal, Modo } from './tipos'

export type FuncionId = 'chat' | 'agente' | 'vision' | 'pensar' | 'documentos' | 'imagen' | 'modelo3d'

export interface Funcion {
  id: FuncionId
  nombre: string
  descripcion: string
  /** Capacidades que le hacen falta al modelo elegido. */
  requiere: Capacidad[]
  /** Quién la hace posible: el modelo elegido, un modelo de embeddings o ComfyUI. */
  motor: 'modelo' | 'embeddings' | 'comfy'
}

export const FUNCIONES: Funcion[] = [
  { id: 'chat', nombre: 'Chat', descripcion: 'Preguntas y respuestas', requiere: ['completion'], motor: 'modelo' },
  {
    id: 'agente',
    nombre: 'Agente',
    descripcion: 'Lee y edita archivos, corre comandos y usa herramientas MCP',
    requiere: ['completion', 'tools'],
    motor: 'modelo'
  },
  { id: 'vision', nombre: 'Ver imágenes', descripcion: 'Adjuntar capturas y fotos', requiere: ['vision'], motor: 'modelo' },
  { id: 'pensar', nombre: 'Pensar', descripcion: 'Razona antes de responder', requiere: ['thinking'], motor: 'modelo' },
  {
    id: 'documentos',
    nombre: 'Buscar en documentos',
    descripcion: 'Búsqueda por significado dentro de la carpeta',
    requiere: ['tools'],
    motor: 'embeddings'
  },
  { id: 'imagen', nombre: 'Imágenes', descripcion: 'Texto a imagen con ComfyUI', requiere: [], motor: 'comfy' },
  {
    id: 'modelo3d',
    nombre: '3D',
    descripcion: 'Imagen o texto a modelo 3D (GLB) con Hunyuan3D',
    requiere: [],
    motor: 'comfy'
  }
]

export const ETIQUETA_CAPACIDAD: Record<Capacidad, string> = {
  completion: 'Texto',
  tools: 'Herramientas',
  vision: 'Visión',
  thinking: 'Razona',
  embedding: 'Embeddings',
  insert: 'Autocompletar'
}

export interface Disponibilidad {
  activa: boolean
  motivo?: string
  /** Modelos instalados que sí la tienen. */
  alternativas: string[]
  /** Modelo del catálogo para descargar cuando no hay ninguno instalado. */
  sugerencia?: string
}

export function funcion(id: FuncionId): Funcion {
  return FUNCIONES.find((f) => f.id === id)!
}

export function tiene(m: ModeloLocal | undefined, caps: Capacidad[]): boolean {
  return !!m && caps.every((c) => m.capacidades.includes(c))
}

export function modelosEmbeddings(entorno: Entorno): ModeloLocal[] {
  return entorno.ollama.modelos.filter((m) => m.capacidades.includes('embedding'))
}

export function disponibilidad(id: FuncionId, modelo: ModeloLocal | undefined, entorno: Entorno): Disponibilidad {
  const f = funcion(id)
  if (f.motor === 'comfy') return disponibilidadComfy(id, entorno)

  const alternativas = entorno.ollama.modelos
    .filter((m) => m.nombre !== modelo?.nombre && tiene(m, f.requiere))
    .map((m) => m.nombre)
  const sugerencia = alternativas.length ? undefined : sugerir(f.requiere, entorno)

  if (entorno.ollama.estado !== 'conectado') {
    return { activa: false, motivo: 'Ollama no está corriendo.', alternativas: [], sugerencia }
  }
  if (!modelo) {
    const motivo = entorno.ollama.modelos.length ? 'Elige un modelo.' : 'No tienes modelos instalados.'
    return { activa: false, motivo, alternativas, sugerencia }
  }

  const n = modelo.nombre
  if (!tiene(modelo, f.requiere)) {
    const motivos: Record<FuncionId, string> = {
      chat: `${n} es un modelo de embeddings: sirve para buscar, no para conversar.`,
      agente: `${n} no sabe usar herramientas, así que no puede leer ni editar archivos.`,
      vision: `${n} no ve imágenes.`,
      pensar: `${n} no tiene modo de razonamiento.`,
      documentos: `${n} no usa herramientas; la búsqueda en documentos va dentro del agente.`,
      imagen: '',
      modelo3d: ''
    }
    return { activa: false, motivo: motivos[id], alternativas, sugerencia }
  }

  if (f.motor === 'embeddings' && modelosEmbeddings(entorno).length === 0) {
    return {
      activa: false,
      motivo: 'Instala un modelo de embeddings, por ejemplo nomic-embed-text.',
      alternativas: [],
      sugerencia: 'nomic-embed-text'
    }
  }
  return { activa: true, alternativas }
}

function disponibilidadComfy(id: FuncionId, entorno: Entorno): Disponibilidad {
  const c = entorno.comfy
  if (!c.conectado) {
    return { activa: false, motivo: `ComfyUI no responde en ${c.url}. Ábrelo y vuelve a detectar.`, alternativas: [] }
  }
  if (id === 'imagen' && c.checkpointsImagen.length === 0) {
    return {
      activa: false,
      motivo: 'ComfyUI no tiene un checkpoint de imagen (SDXL, Flux…) en models/checkpoints.',
      alternativas: []
    }
  }
  if (id === 'modelo3d') {
    if (!c.nodos3d) {
      return {
        activa: false,
        motivo: `Tu ComfyUI no tiene los nodos de Hunyuan3D (${c.faltan.join(', ')}). Actualízalo.`,
        alternativas: []
      }
    }
    if (c.checkpoints3d.length === 0) {
      return {
        activa: false,
        motivo: 'Falta el checkpoint de Hunyuan3D (hunyuan_3d_v2.1.safetensors) en models/checkpoints.',
        alternativas: []
      }
    }
  }
  return { activa: true, alternativas: [] }
}

function sugerir(caps: Capacidad[], entorno: Entorno): string | undefined {
  const instalados = new Set(entorno.ollama.modelos.map((m) => m.nombre))
  const opciones = CATALOGO.filter((m) => caps.every((c) => m.capacidades.includes(c)) && !instalados.has(m.nombre))
  const { vramGb, ramGb } = entorno.hardware
  return (opciones.find((m) => cabe(m, vramGb, ramGb)) ?? opciones[0])?.nombre
}

/** Qué función hay que tener activa para entrar en cada modo. */
export const FUNCION_DE_MODO: Record<Modo, FuncionId> = {
  chat: 'chat',
  agente: 'agente',
  imagen: 'imagen',
  modelo3d: 'modelo3d'
}

/** El primer modo que el modelo puede usar, empezando por el preferido. */
export function modoPosible(preferido: Modo, modelo: ModeloLocal | undefined, entorno: Entorno): Modo {
  const orden: Modo[] = [preferido, 'agente', 'chat', 'imagen', 'modelo3d']
  return orden.find((m) => disponibilidad(FUNCION_DE_MODO[m], modelo, entorno).activa) ?? preferido
}

/** Un modelo de chat razonable para empezar: con herramientas, si hay. */
export function modeloInicial(entorno: Entorno, preferido?: string): string | undefined {
  const ms = entorno.ollama.modelos.filter((m) => m.capacidades.includes('completion'))
  if (preferido && ms.some((m) => m.nombre === preferido)) return preferido
  return (ms.find((m) => m.capacidades.includes('tools')) ?? ms[0])?.nombre
}
