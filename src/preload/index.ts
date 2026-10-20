import { contextBridge, ipcRenderer } from 'electron'
import type { ApiTaller } from '@shared/api'

const api: ApiTaller = {
  plataforma: process.platform,
  entorno: (forzar) => ipcRenderer.invoke('entorno:detectar', forzar),
  abrirOllama: () => ipcRenderer.invoke('ollama:abrir'),
  descargarModelo: (m) => ipcRenderer.invoke('ollama:descargar', m),
  cancelarDescarga: (m) => ipcRenderer.invoke('ollama:cancelarDescarga', m),
  borrarModelo: (m) => ipcRenderer.invoke('ollama:borrar', m),

  conversaciones: () => ipcRenderer.invoke('conv:listar'),
  abrir: (id) => ipcRenderer.invoke('conv:abrir', id),
  nueva: (o) => ipcRenderer.invoke('conv:nueva', o),
  actualizar: (id, c) => ipcRenderer.invoke('conv:actualizar', id, c),
  borrar: (id) => ipcRenderer.invoke('conv:borrar', id),
  enviar: (id, envio) => ipcRenderer.invoke('conv:enviar', id, envio),
  detener: (id) => ipcRenderer.invoke('conv:detener', id),
  responderPermiso: (id, r) => ipcRenderer.invoke('permiso:responder', id, r),

  elegirCarpeta: () => ipcRenderer.invoke('dialogo:carpeta'),
  elegirImagen: () => ipcRenderer.invoke('dialogo:imagen'),
  ajustes: () => ipcRenderer.invoke('ajustes:leer'),
  guardarAjustes: (a) => ipcRenderer.invoke('ajustes:guardar', a),
  recargarMcp: () => ipcRenderer.invoke('mcp:recargar'),
  leerMcpProyecto: (carpeta) => ipcRenderer.invoke('mcp:proyecto', carpeta),
  abrirExterno: (url) => ipcRenderer.invoke('externo:abrir', url),
  mostrarArchivo: (ruta) => ipcRenderer.invoke('archivo:mostrar', ruta),
  urlArchivo: (ruta) => `taller://archivo/?ruta=${encodeURIComponent(ruta)}`,

  validar: (modelo) => ipcRenderer.invoke('validador:correr', modelo),
  detenerValidacion: () => ipcRenderer.invoke('validador:detener'),
  copiarTexto: (texto) => ipcRenderer.invoke('validador:copiar', texto),
  guardarInforme: (texto) => ipcRenderer.invoke('validador:guardar', texto),
  abrirDatos: () => ipcRenderer.invoke('datos:abrir'),

  alEvento(cb) {
    const f = (_e: unknown, id: string, ev: Parameters<typeof cb>[1]) => cb(id, ev)
    ipcRenderer.on('conv:evento', f)
    return () => ipcRenderer.off('conv:evento', f)
  },
  alDescarga(cb) {
    const f = (_e: unknown, p: Parameters<typeof cb>[0]) => cb(p)
    ipcRenderer.on('descarga', f)
    return () => ipcRenderer.off('descarga', f)
  },
  alValidacion(cb) {
    const f = (_e: unknown, p: Parameters<typeof cb>[0]) => cb(p)
    ipcRenderer.on('validador:progreso', f)
    return () => ipcRenderer.off('validador:progreso', f)
  }
}

contextBridge.exposeInMainWorld('taller', api)
