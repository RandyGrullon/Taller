import { useEffect, useLayoutEffect, useRef, useState, type ComponentType } from 'react'
import { disponibilidad, FUNCION_DE_MODO, funcion, type Disponibilidad, type FuncionId } from '@shared/funciones'
import type { Entorno, ModeloLocal, Modo, Tarea } from '@shared/tipos'
import { api, guardarLocal, leerComoDataUrl, leerLocal } from '../util'
import { Bombillo, Burbuja, Candado, Check, Clip, Cubo, Cuadro, Equis, Flecha, Imagen, Martillo } from './Iconos'

const MODOS: { id: Modo; nombre: string; Icono: ComponentType<{ tam?: number }> }[] = [
  { id: 'chat', nombre: 'Chat', Icono: Burbuja },
  { id: 'agente', nombre: 'Agente', Icono: Martillo },
  { id: 'imagen', nombre: 'Imagen', Icono: Imagen },
  { id: 'modelo3d', nombre: '3D', Icono: Cubo }
]

const PLACEHOLDER: Record<Modo, string> = {
  chat: 'Pregunta lo que quieras…',
  agente: 'Pide un cambio, un arreglo o que te explique el proyecto…',
  imagen: 'Describe la imagen que quieres…',
  modelo3d: 'Describe un objeto, o adjunta una foto para convertirla en 3D…'
}

interface Props {
  entorno: Entorno
  modelo?: ModeloLocal
  modo: Modo
  ocupada: boolean
  texto: string
  uso?: { prompt: number; contexto: number }
  tareas: Tarea[]
  setTexto(t: string): void
  onModo(m: Modo): void
  onEnviar(texto: string, imagenes: string[], pensar: boolean): void
  onDetener(): void
  onCambiarModelo(nombre: string): void
  onIrAModelos(): void
}

interface Explicacion {
  id: FuncionId
  disp: Disponibilidad
}

export function Compositor(p: Props) {
  const [imagenes, setImagenes] = useState<string[]>([])
  const [pensar, setPensar] = useState(() => leerLocal('taller.pensar', true))
  const [explicar, setExplicar] = useState<Explicacion | null>(null)
  const [arrastrando, setArrastrando] = useState(false)
  const [sacudida, setSacudida] = useState<Modo | null>(null)
  const [indicador, setIndicador] = useState<{ left: number; width: number } | null>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  const pestanas = useRef<Partial<Record<Modo, HTMLButtonElement | null>>>({})

  // La píldora del modo activo se desliza a la pestaña nueva
  const bloqueos = MODOS.map((m) => disponibilidad(FUNCION_DE_MODO[m.id], p.modelo, p.entorno).activa).join()
  useLayoutEffect(() => {
    const medir = () => {
      const b = pestanas.current[p.modo]
      if (b) setIndicador({ left: b.offsetLeft, width: b.offsetWidth })
    }
    medir()
    window.addEventListener('resize', medir)
    return () => window.removeEventListener('resize', medir)
  }, [p.modo, bloqueos])

  const dispModo = disponibilidad(FUNCION_DE_MODO[p.modo], p.modelo, p.entorno)
  const conversa = p.modo === 'chat' || p.modo === 'agente'
  const dispVision: Disponibilidad =
    p.modo === 'modelo3d'
      ? { activa: true, alternativas: [] }
      : p.modo === 'imagen'
        ? { activa: false, motivo: 'Las imágenes se crean a partir de texto; para partir de una foto usa 3D.', alternativas: [] }
        : disponibilidad('vision', p.modelo, p.entorno)
  const dispPensar = disponibilidad('pensar', p.modelo, p.entorno)

  // Al cambiar a un modelo sin visión se sueltan los adjuntos que ya no puede ver
  useEffect(() => {
    if (!dispVision.activa && imagenes.length) setImagenes([])
  }, [dispVision.activa, imagenes.length])

  useEffect(() => {
    const t = area.current
    if (!t) return
    t.style.height = 'auto'
    t.style.height = Math.min(t.scrollHeight, 280) + 'px'
  }, [p.texto])

  useEffect(() => {
    area.current?.focus()
  }, [p.modo])

  const puedeEnviar = !p.ocupada && dispModo.activa && (p.texto.trim() !== '' || (p.modo === 'modelo3d' && imagenes.length > 0))

  const enviar = () => {
    if (!puedeEnviar) return
    const texto = p.texto.trim() || 'Convierte esta imagen en un modelo 3D.'
    p.onEnviar(texto, imagenes, conversa && dispPensar.activa && pensar)
    p.setTexto('')
    setImagenes([])
  }

  const agregar = async (archivos: File[]) => {
    const fotos = archivos.filter((f) => f.type.startsWith('image/'))
    if (!fotos.length) return
    if (!dispVision.activa) return setExplicar({ id: 'vision', disp: dispVision })
    const urls = await Promise.all(fotos.map(leerComoDataUrl))
    setImagenes((v) => [...v, ...urls].slice(0, p.modo === 'modelo3d' ? 1 : 6))
  }

  const pct = p.uso && p.uso.contexto ? Math.min(100, Math.round((p.uso.prompt / p.uso.contexto) * 100)) : 0

  return (
    <div className="zona-compositor">
      {p.tareas.length > 0 && conversa && (p.ocupada || p.tareas.some((t) => t.estado !== 'hecha')) && (
        <div className="tareas">
          <div className="t">
            Tareas · {p.tareas.filter((t) => t.estado === 'hecha').length}/{p.tareas.length}
          </div>
          {p.tareas.map((t, i) => (
            <div key={i} className={`tarea ${t.estado}`}>
              <span className="marca-t">{t.estado === 'hecha' && <Check tam={10} strokeWidth={3} />}</span>
              {t.contenido}
            </div>
          ))}
        </div>
      )}
      <div
        className={`compositor ${arrastrando ? 'arrastrando' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setArrastrando(true)
        }}
        onDragLeave={() => setArrastrando(false)}
        onDrop={(e) => {
          e.preventDefault()
          setArrastrando(false)
          void agregar([...e.dataTransfer.files])
        }}
      >
        {explicar && (
          <div className="explicacion" role="dialog" aria-label="Función bloqueada">
            <button className="icono-boton cerrar" onClick={() => setExplicar(null)} aria-label="Cerrar">
              <Equis tam={15} />
            </button>
            <div className="t">
              <Candado tam={15} /> {funcion(explicar.id).nombre}: no disponible
            </div>
            <div>{explicar.disp.motivo}</div>
            {explicar.disp.alternativas.length > 0 && (
              <div className="acciones">
                <span style={{ color: 'var(--texto-3)', fontSize: 12.5, alignSelf: 'center' }}>Tus modelos que sí pueden:</span>
                {explicar.disp.alternativas.slice(0, 4).map((n) => (
                  <button
                    key={n}
                    className="boton chico"
                    onClick={() => {
                      p.onCambiarModelo(n)
                      setExplicar(null)
                    }}
                  >
                    Usar {n}
                  </button>
                ))}
              </div>
            )}
            {(explicar.disp.sugerencia || funcion(explicar.id).motor !== 'comfy') && explicar.disp.alternativas.length === 0 && (
              <div className="acciones">
                <button
                  className="boton chico primario"
                  onClick={() => {
                    p.onIrAModelos()
                    setExplicar(null)
                  }}
                >
                  {explicar.disp.sugerencia ? `Descargar ${explicar.disp.sugerencia}` : 'Ver modelos'}
                </button>
              </div>
            )}
            {funcion(explicar.id).motor === 'comfy' && (
              <div className="acciones">
                <button className="boton chico" onClick={() => void api.abrirExterno('https://github.com/Comfy-Org/ComfyUI#installing')}>
                  Cómo instalar ComfyUI
                </button>
                <button
                  className="boton chico"
                  onClick={() => {
                    p.onIrAModelos()
                    setExplicar(null)
                  }}
                >
                  Ver motores
                </button>
              </div>
            )}
          </div>
        )}

        <div className={`modos ${indicador ? 'con-indicador' : ''}`} role="tablist" aria-label="Modo">
          {indicador && <span className="indicador" style={indicador} />}
          {MODOS.map(({ id, nombre, Icono }) => {
            const d = disponibilidad(FUNCION_DE_MODO[id], p.modelo, p.entorno)
            return (
              <button
                key={id}
                ref={(b) => {
                  pestanas.current[id] = b
                }}
                role="tab"
                aria-selected={p.modo === id}
                className={`modo ${p.modo === id ? 'activo' : ''} ${d.activa ? '' : 'bloqueado'} ${sacudida === id ? 'sacudir' : ''}`}
                title={d.activa ? funcion(FUNCION_DE_MODO[id]).descripcion : d.motivo}
                onClick={() => {
                  if (!d.activa) {
                    setSacudida(id)
                    setTimeout(() => setSacudida(null), 420)
                    return setExplicar({ id: FUNCION_DE_MODO[id], disp: d })
                  }
                  setExplicar(null)
                  p.onModo(id)
                }}
              >
                {d.activa ? <Icono tam={15} /> : <Candado tam={14} />} {nombre}
              </button>
            )
          })}
        </div>

        {imagenes.length > 0 && (
          <div className="adjuntos">
            {imagenes.map((src, i) => (
              <div key={i} className="adjunto">
                <img src={src} alt="Adjunto" />
                <button onClick={() => setImagenes((v) => v.filter((_, j) => j !== i))} aria-label="Quitar">
                  <Equis tam={11} />
                </button>
              </div>
            ))}
          </div>
        )}

        <textarea
          ref={area}
          value={p.texto}
          rows={1}
          placeholder={dispModo.activa ? PLACEHOLDER[p.modo] : dispModo.motivo}
          onChange={(e) => p.setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              enviar()
            }
          }}
          onPaste={(e) => {
            const fotos = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'))
            if (fotos.length) {
              e.preventDefault()
              void agregar(fotos)
            }
          }}
        />

        <div className="barra-compositor">
          <button
            className="icono-boton"
            title={dispVision.activa ? (p.modo === 'modelo3d' ? 'Adjuntar la foto del objeto' : 'Adjuntar imagen') : dispVision.motivo}
            aria-label="Adjuntar imagen"
            onClick={async () => {
              if (!dispVision.activa) return setExplicar({ id: 'vision', disp: dispVision })
              const url = await api.elegirImagen()
              if (url) setImagenes((v) => [...v, url].slice(0, p.modo === 'modelo3d' ? 1 : 6))
            }}
            style={dispVision.activa ? undefined : { color: 'var(--bloqueo)' }}
          >
            <Clip />
            {!dispVision.activa && (
              <span className="candado">
                <Candado tam={10} />
              </span>
            )}
          </button>
          {conversa && (
            <button
              className={`icono-boton ${dispPensar.activa && pensar ? 'encendido' : ''}`}
              title={dispPensar.activa ? (pensar ? 'Pensar antes de responder: activado' : 'Pensar antes de responder: apagado') : dispPensar.motivo}
              aria-label="Pensar"
              aria-pressed={dispPensar.activa && pensar}
              onClick={() => {
                if (!dispPensar.activa) return setExplicar({ id: 'pensar', disp: dispPensar })
                setPensar(!pensar)
                guardarLocal('taller.pensar', !pensar)
              }}
              style={dispPensar.activa ? undefined : { color: 'var(--bloqueo)' }}
            >
              <Bombillo />
              {!dispPensar.activa && (
                <span className="candado">
                  <Candado tam={10} />
                </span>
              )}
            </button>
          )}
          <span className="espaciador" />
          {conversa && pct > 0 && (
            <span className="uso-contexto" title={`${p.uso!.prompt.toLocaleString()} de ${p.uso!.contexto.toLocaleString()} tokens`}>
              <span className="medidor">
                <div style={{ width: `${pct}%` }} />
              </span>
              {pct}% del contexto
            </span>
          )}
          {p.ocupada ? (
            <button className="enviar detener" onClick={p.onDetener} title="Detener" aria-label="Detener">
              <Cuadro />
            </button>
          ) : (
            <button className="enviar" onClick={enviar} disabled={!puedeEnviar} title="Enviar (Enter)" aria-label="Enviar">
              <Flecha />
            </button>
          )}
        </div>
      </div>
      <div className="nota-compositor">Todo corre en tu PC con Ollama{p.modo === 'imagen' || p.modo === 'modelo3d' ? ' y ComfyUI' : ''}. Revisa lo que hace antes de darlo por bueno.</div>
    </div>
  )
}
