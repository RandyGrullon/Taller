// Tipos que comparten el proceso principal, el preload y la interfaz.

/** Lo que Ollama dice que sabe hacer un modelo (`/api/show` → `capabilities`). */
export type Capacidad = 'completion' | 'tools' | 'vision' | 'thinking' | 'embedding' | 'insert'

export interface ModeloLocal {
  nombre: string
  familia?: string
  parametros?: string
  cuantizacion?: string
  tamano: number
  capacidades: Capacidad[]
  /** Contexto máximo que admite el modelo (tokens), si Ollama lo informa. */
  contexto?: number
  modificado?: string
}

export interface EstadoOllama {
  estado: 'conectado' | 'apagado' | 'no-instalado'
  url: string
  version?: string
  modelos: ModeloLocal[]
  /** Ruta del ejecutable cuando está instalado pero apagado. */
  ejecutable?: string
  error?: string
}

export interface EstadoComfy {
  conectado: boolean
  url: string
  version?: string
  gpu?: string
  vramGb?: number
  checkpointsImagen: string[]
  checkpoints3d: string[]
  nodos3d: boolean
  faltan: string[]
  mensaje: string
}

export interface Hardware {
  gpu?: string
  vramGb?: number
  ramGb: number
  so: string
}

export interface Entorno {
  ollama: EstadoOllama
  comfy: EstadoComfy
  hardware: Hardware
  mcp: EstadoMcp[]
}

export interface ServidorMcp {
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  /** Para apagar un servidor sin borrarlo. */
  disabled?: boolean
}

export interface EstadoMcp {
  nombre: string
  estado: 'conectado' | 'error' | 'apagado'
  herramientas: string[]
  error?: string
}

export type Modo = 'chat' | 'agente' | 'imagen' | 'modelo3d'

/** Cuánto puede hacer el agente sin preguntar. */
export type ModoPermiso = 'preguntar' | 'editar' | 'todo' | 'plan'

export interface Ajustes {
  ollamaUrl: string
  comfyUrl: string
  /** Ventana de contexto que se pide a Ollama (num_ctx). */
  contexto: number
  permisos: ModoPermiso
  tema: 'sistema' | 'claro' | 'oscuro'
  modeloPorDefecto?: string
  modeloEmbeddings?: string
  checkpointImagen?: string
  checkpoint3d?: string
  /** Dónde se guardan imágenes y modelos 3D cuando la conversación no tiene carpeta. */
  carpetaSalidas: string
  maxPasos: number
  /** En Imágenes y 3D, el modelo de chat reescribe la idea como prompt en inglés. */
  mejorarPrompt: boolean
  mcpServers: Record<string, ServidorMcp>
  /** El recorrido guiado se muestra solo la primera vez. */
  tutorialVisto: boolean
}

export interface Archivo {
  ruta: string
  tipo: 'imagen' | 'modelo3d'
}

export interface Tarea {
  contenido: string
  estado: 'pendiente' | 'en_curso' | 'hecha'
}

export type EstadoHerramienta = 'esperando' | 'corriendo' | 'ok' | 'error' | 'rechazada'

export type Item =
  | { id: string; tipo: 'usuario'; texto: string; imagenes?: string[]; modo: Modo; ts: number }
  | { id: string; tipo: 'asistente'; texto: string; pensamiento?: string; modelo?: string; ts: number }
  | {
      id: string
      tipo: 'herramienta'
      nombre: string
      resumen: string
      args: Record<string, unknown>
      estado: EstadoHerramienta
      resultado?: string
      archivos?: Archivo[]
      ts: number
    }
  | {
      id: string
      tipo: 'permiso'
      herramientaId: string
      nombre: string
      resumen: string
      detalle?: string
      ts: number
    }
  | { id: string; tipo: 'aviso'; texto: string; nivel: 'info' | 'error'; ts: number }
  | {
      id: string
      tipo: 'generacion'
      clase: 'imagen' | 'modelo3d'
      prompt: string
      promptFinal?: string
      estado: 'corriendo' | 'ok' | 'error'
      progreso: number
      etapa?: string
      archivos: Archivo[]
      error?: string
      ts: number
    }

export type TipoItem = Item['tipo']

export interface Conversacion {
  id: string
  titulo: string
  creada: number
  actualizada: number
  modelo?: string
  carpeta?: string
  modo: Modo
  permisos: ModoPermiso
  items: Item[]
  tareas: Tarea[]
  ocupada: boolean
  uso?: { prompt: number; contexto: number }
}

export interface ResumenConversacion {
  id: string
  titulo: string
  actualizada: number
  modelo?: string
  carpeta?: string
}

/** Lo que el proceso principal le cuenta a la interfaz mientras trabaja. */
export type Evento =
  | { tipo: 'item'; item: Item }
  | { tipo: 'texto'; itemId: string; delta: string }
  | { tipo: 'pensamiento'; itemId: string; delta: string }
  | { tipo: 'actualizar'; itemId: string; cambios: Record<string, unknown> }
  | { tipo: 'quitar'; itemId: string }
  | { tipo: 'tareas'; tareas: Tarea[] }
  | { tipo: 'uso'; prompt: number; contexto: number }
  | { tipo: 'ocupada'; ocupada: boolean }
  | { tipo: 'titulo'; titulo: string }

export interface Envio {
  texto: string
  /** Imágenes adjuntas como data URL. */
  imagenes?: string[]
  modo: Modo
  pensar: boolean
}

export interface ProgresoDescarga {
  modelo: string
  estado: string
  completado?: number
  total?: number
  terminado?: boolean
  error?: string
}

export type RespuestaPermiso = 'si' | 'siempre' | 'no'

export type EstadoPrueba = 'pendiente' | 'corriendo' | 'ok' | 'aviso' | 'error' | 'omitida'

/** Una comprobación del validador. */
export interface Prueba {
  id: string
  grupo: string
  nombre: string
  /** Qué revisa y por qué importa, en palabras simples. */
  queValida: string
  estado: EstadoPrueba
  detalle?: string
  ms?: number
  /** Lo que devolvió el modelo o el motor, para el informe. */
  crudo?: string
}

export interface InformeValidacion {
  fecha: string
  pruebas: Prueba[]
  markdown: string
  /** Carpeta temporal con lo que generó la validación. */
  carpeta: string
}
