import { lazy, Suspense, useState } from 'react'
import type { Archivo, Item, RespuestaPermiso } from '@shared/tipos'
import { api } from '../util'
import {
  Archivo as IconoArchivo,
  Bombillo,
  Carpeta,
  Cargando,
  Check,
  Cubo,
  Derecha,
  Equis,
  Escudo,
  Imagen,
  Lapiz,
  Llave,
  Lupa,
  Mundo,
  Terminal,
  Burbuja,
  Enchufe
} from './Iconos'
import { Logo } from './Logo'
import { Markdown } from './Markdown'

// three.js pesa; se carga la primera vez que hay un modelo 3D que mostrar
const Visor3D = lazy(() => import('./Visor3D').then((m) => ({ default: m.Visor3D })))

const NOMBRE_MODO = { chat: 'Chat', agente: 'Agente', imagen: 'Imagen', modelo3d: '3D' }

function iconoHerramienta(nombre: string) {
  if (nombre === 'run_command') return <Terminal />
  if (nombre === 'read_file') return <IconoArchivo />
  if (nombre === 'write_file' || nombre === 'edit_file') return <Lapiz />
  if (nombre === 'grep' || nombre === 'list_files' || nombre === 'semantic_search') return <Lupa />
  if (nombre === 'web_fetch') return <Mundo />
  if (nombre === 'generate_image') return <Imagen />
  if (nombre === 'generate_3d') return <Cubo />
  if (nombre.startsWith('mcp__')) return <Enchufe />
  return <Llave />
}

function Archivos({ archivos, conAcciones = true, referencia = false }: { archivos: Archivo[]; conAcciones?: boolean; referencia?: boolean }) {
  return (
    <>
      {archivos.map((a) =>
        a.tipo === 'imagen' ? (
          <img
            key={a.ruta}
            className={`resultado-imagen ${referencia ? 'referencia' : ''}`}
            src={api.urlArchivo(a.ruta)}
            alt={referencia ? 'Imagen de referencia para el 3D' : 'Imagen generada'}
            title={referencia ? 'Imagen de referencia que se convirtió en 3D' : undefined}
          />
        ) : (
          <Suspense key={a.ruta} fallback={<div className="visor3d" />}>
            <Visor3D url={api.urlArchivo(a.ruta)} />
          </Suspense>
        )
      )}
      {conAcciones && archivos.length > 0 && (
        <div className="acciones">
          <button className="boton chico" onClick={() => void api.mostrarArchivo(archivos[archivos.length - 1].ruta)}>
            <Carpeta tam={14} /> Mostrar en la carpeta
          </button>
        </div>
      )}
    </>
  )
}

function Diff({ texto }: { texto: string }) {
  return (
    <pre className="diff">
      {texto.split('\n').map((l, i) => (
        <div key={i} className={l.startsWith('+ ') ? 'mas' : l.startsWith('- ') ? 'menos' : l.startsWith('@@') || l.startsWith('…') ? 'meta' : ''}>
          {l || ' '}
        </div>
      ))}
    </pre>
  )
}

function Herramienta({ it }: { it: Extract<Item, { tipo: 'herramienta' }> }) {
  const [abierta, setAbierta] = useState(false)
  const estado = {
    esperando: 'esperando permiso',
    corriendo: 'trabajando…',
    ok: '',
    error: 'falló',
    rechazada: 'rechazada'
  }[it.estado]
  return (
    <div className={`herramienta ${it.estado}`}>
      <button onClick={() => setAbierta(!abierta)} aria-expanded={abierta}>
        <span className="icono-h">
          {it.estado === 'corriendo' ? <Cargando tam={14} /> : it.estado === 'error' || it.estado === 'rechazada' ? <Equis tam={14} /> : iconoHerramienta(it.nombre)}
        </span>
        <span className="resumen-h">{it.resumen}</span>
        {estado && <span className={`estado-h ${it.estado === 'corriendo' || it.estado === 'esperando' ? 'brillo-texto' : ''}`}>{estado}</span>}
        <Derecha tam={14} className="chevron" />
      </button>
      {it.estado === 'corriendo' && it.resultado && !abierta && (
        <div className="cuerpo-h">
          <span className="etapa">{it.resultado}</span>
        </div>
      )}
      {abierta && (
        <div className="cuerpo-h">
          <span className="etiqueta-h">Entrada</span>
          <pre>{JSON.stringify(it.args, null, 2)}</pre>
          {it.resultado && (
            <>
              <span className="etiqueta-h">Resultado</span>
              <pre>{it.resultado}</pre>
            </>
          )}
        </div>
      )}
      {it.archivos && it.archivos.length > 0 && (
        <div className="cuerpo-h">
          <Archivos archivos={it.archivos} />
        </div>
      )}
    </div>
  )
}

const PREGUNTA: Record<string, string> = {
  run_command: 'Taller quiere ejecutar un comando',
  write_file: 'Taller quiere escribir un archivo',
  edit_file: 'Taller quiere editar un archivo',
  web_fetch: 'Taller quiere leer una página web'
}

function Permiso({ it, onResponder }: { it: Extract<Item, { tipo: 'permiso' }>; onResponder(id: string, r: RespuestaPermiso): void }) {
  const pregunta = PREGUNTA[it.nombre] ?? (it.nombre.startsWith('mcp__') ? 'Taller quiere usar una herramienta MCP' : 'Taller necesita tu permiso')
  const esDiff = it.detalle && /^(@@|\+ |- )/m.test(it.detalle)
  return (
    <div className="permiso" role="alertdialog" aria-label={pregunta}>
      <div className="pregunta">
        <Escudo tam={17} /> {pregunta}
      </div>
      <div className="que">{it.resumen}</div>
      {it.detalle && it.nombre !== 'run_command' && (esDiff ? <Diff texto={it.detalle} /> : <pre className="diff">{it.detalle}</pre>)}
      <div className="acciones">
        <button className="boton primario" onClick={() => onResponder(it.id, 'si')} autoFocus>
          <Check tam={15} /> Permitir
        </button>
        <button className="boton" onClick={() => onResponder(it.id, 'siempre')}>
          Permitir siempre en esta conversación
        </button>
        <button className="boton peligro" onClick={() => onResponder(it.id, 'no')}>
          <Equis tam={15} /> Rechazar
        </button>
      </div>
    </div>
  )
}

/** Mientras ComfyUI dibuja: un lienzo con colores que se mueven y el porcentaje. */
function Lienzo({ progreso, etapa }: { progreso: number; etapa?: string }) {
  return (
    <div className="lienzo" role="status" aria-label="Generando imagen">
      <div className="aurora" />
      <div className="grano" />
      <div className="centro">
        <Logo tam={48} animado />
        <span className="pct">{Math.round(progreso * 100)}%</span>
        <span className="etapa">{etapa}</span>
      </div>
    </div>
  )
}

const PARTICULAS = [8, 19, 27, 36, 44, 52, 61, 69, 77, 86, 92, 14].map((x, i) => ({
  left: `${x}%`,
  bottom: `${10 + ((i * 37) % 30)}%`,
  animationDelay: `${(i * 0.27) % 3}s`
}))

/** Mientras Hunyuan3D trabaja: un cubo de alambre que gira y un escáner. */
function Forja3D({ progreso, etapa }: { progreso: number; etapa?: string }) {
  return (
    <div className="forja3d" role="status" aria-label="Generando modelo 3D">
      <div className="escena">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="cara" />
        ))}
      </div>
      <div className="escaner" />
      {PARTICULAS.map((estilo, i) => (
        <span key={i} className="particula" style={estilo} />
      ))}
      <div className="leyenda">
        {Math.round(progreso * 100)}% · {etapa}
      </div>
    </div>
  )
}

function Generacion({ it }: { it: Extract<Item, { tipo: 'generacion' }> }) {
  const corriendo = it.estado === 'corriendo'
  // En 3D desde texto primero llega la imagen de referencia; el cubo sigue hasta que llega el GLB
  const listos = corriendo ? it.archivos.filter((a) => a.tipo === 'imagen') : it.archivos
  return (
    <div className="generacion">
      <div className="cab">
        {it.clase === 'imagen' ? <Imagen /> : <Cubo />}
        {it.clase === 'imagen' ? 'Imagen' : 'Modelo 3D'}
        {corriendo && <span className="estado-h brillo-texto">{it.clase === 'imagen' ? 'pintando…' : 'esculpiendo…'}</span>}
      </div>
      {it.promptFinal && it.promptFinal !== it.prompt && <div className="prompt-final">Prompt: {it.promptFinal}</div>}
      {it.estado === 'error' && <div className="aviso error">{it.error}</div>}
      <Archivos archivos={listos} conAcciones={!corriendo} referencia={it.clase === 'modelo3d'} />
      {corriendo && (it.clase === 'imagen' ? <Lienzo progreso={it.progreso} etapa={it.etapa} /> : <Forja3D progreso={it.progreso} etapa={it.etapa} />)}
      {corriendo && (
        <div className="barra-progreso">
          <div style={{ width: `${Math.max(2, Math.round(it.progreso * 100))}%` }} />
        </div>
      )}
    </div>
  )
}

export function VistaItem({ it, ultimo, ocupada, onResponder }: { it: Item; ultimo: boolean; ocupada: boolean; onResponder(id: string, r: RespuestaPermiso): void }) {
  switch (it.tipo) {
    case 'usuario':
      return (
        <div className="msg-usuario">
          {(it.modo === 'imagen' || it.modo === 'modelo3d') && (
            <div className="modo-etiqueta">
              {it.modo === 'imagen' ? <Imagen tam={13} /> : <Cubo tam={13} />} {NOMBRE_MODO[it.modo]}
            </div>
          )}
          {it.imagenes && (
            <div className="miniaturas">
              {it.imagenes.map((r) => (
                <img key={r} src={api.urlArchivo(r)} alt="Adjunto" />
              ))}
            </div>
          )}
          {it.texto}
        </div>
      )
    case 'asistente': {
      const escribiendo = ultimo && ocupada
      return (
        <div className="msg-asistente">
          {it.pensamiento && (
            <details className={`pensamiento ${escribiendo && !it.texto ? 'activo' : ''}`} open={escribiendo && !it.texto}>
              <summary>
                <Bombillo tam={14} />
                {escribiendo && !it.texto ? <span className="brillo-texto">Pensando…</span> : 'Pensó'}
                <Derecha tam={12} className="flecha-p" />
              </summary>
              <div className="cuerpo">{it.pensamiento}</div>
            </details>
          )}
          {it.texto ? (
            <Markdown texto={it.texto} />
          ) : (
            escribiendo &&
            !it.pensamiento && (
              <div className="escribiendo" aria-label="Escribiendo">
                <span />
                <span />
                <span />
              </div>
            )
          )}
        </div>
      )
    }
    case 'herramienta':
      return <Herramienta it={it} />
    case 'permiso':
      return <Permiso it={it} onResponder={onResponder} />
    case 'generacion':
      return <Generacion it={it} />
    case 'aviso':
      return (
        <div className={`aviso ${it.nivel === 'error' ? 'error' : ''}`}>
          {it.nivel === 'info' && <Burbuja tam={12} />} {it.texto}
        </div>
      )
  }
}
