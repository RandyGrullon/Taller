import type {
  Ajustes,
  Conversacion,
  Entorno,
  Envio,
  Evento,
  Modo,
  ModoPermiso,
  ProgresoDescarga,
  ResumenConversacion,
  RespuestaPermiso,
  ServidorMcp
} from './tipos'

export interface CambiosConversacion {
  modelo?: string
  carpeta?: string | null
  modo?: Modo
  permisos?: ModoPermiso
  titulo?: string
}

/** Lo que el preload expone en `window.taller`. */
export interface ApiTaller {
  plataforma: string
  entorno(forzar?: boolean): Promise<Entorno>
  abrirOllama(): Promise<boolean>
  descargarModelo(modelo: string): Promise<void>
  cancelarDescarga(modelo: string): Promise<void>
  borrarModelo(modelo: string): Promise<void>

  conversaciones(): Promise<ResumenConversacion[]>
  abrir(id: string): Promise<Conversacion>
  nueva(o: { modelo?: string; carpeta?: string; modo?: Modo }): Promise<Conversacion>
  actualizar(id: string, cambios: CambiosConversacion): Promise<Conversacion>
  borrar(id: string): Promise<void>
  enviar(id: string, envio: Envio): Promise<void>
  detener(id: string): Promise<void>
  responderPermiso(permisoId: string, respuesta: RespuestaPermiso): Promise<void>

  elegirCarpeta(): Promise<string | null>
  elegirImagen(): Promise<string | null>
  ajustes(): Promise<Ajustes>
  guardarAjustes(a: Ajustes): Promise<Ajustes>
  recargarMcp(): Promise<void>
  leerMcpProyecto(carpeta: string): Promise<Record<string, ServidorMcp> | null>
  abrirExterno(url: string): Promise<void>
  mostrarArchivo(ruta: string): Promise<void>
  urlArchivo(ruta: string): string

  alEvento(cb: (id: string, e: Evento) => void): () => void
  alDescarga(cb: (p: ProgresoDescarga) => void): () => void
}
