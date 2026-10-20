import { useEffect, useRef, useState } from 'react'
import type { EstadoPrueba, InformeValidacion, Prueba } from '@shared/tipos'
import { api } from '../util'
import { Cargando, Carpeta, Check, Copiar, Derecha, Equis, EscudoCheck, Exclamacion, Guardar, Menos, Recargar } from './Iconos'
import { Logo } from './Logo'

const ETIQUETA: Record<EstadoPrueba, string> = {
  pendiente: 'En espera',
  corriendo: 'Revisando',
  ok: 'Bien',
  aviso: 'Revisar',
  error: 'Falla',
  omitida: 'Omitida'
}

function Icono({ estado }: { estado: EstadoPrueba }) {
  switch (estado) {
    case 'corriendo':
      return <Cargando tam={15} />
    case 'ok':
      return <Check tam={15} strokeWidth={2.6} />
    case 'aviso':
      return <Exclamacion tam={15} strokeWidth={2.8} />
    case 'error':
      return <Equis tam={14} strokeWidth={2.6} />
    case 'omitida':
      return <Menos tam={14} strokeWidth={2.6} />
    default:
      return null
  }
}

function tiempo(ms?: number): string {
  if (ms === undefined) return ''
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`
}

interface Props {
  modeloPreferido?: string
  onCerrar(): void
}

/** Revisa todo con un clic: no pide nada, elige solo los modelos y arma un informe para compartir. */
export function Validador({ modeloPreferido, onCerrar }: Props) {
  const [pruebas, setPruebas] = useState<Prueba[]>([])
  const [informe, setInforme] = useState<InformeValidacion | null>(null)
  const [corriendo, setCorriendo] = useState(false)
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set())
  const [mensaje, setMensaje] = useState('')
  const iniciado = useRef(false)

  const correr = async () => {
    setInforme(null)
    setMensaje('')
    setAbiertas(new Set())
    setCorriendo(true)
    try {
      setInforme(await api.validar(modeloPreferido))
    } catch (e) {
      setMensaje(`No se pudo terminar: ${(e as Error).message}`)
    } finally {
      setCorriendo(false)
    }
  }

  useEffect(() => api.alValidacion(setPruebas), [])

  // Arranca solo al abrir
  useEffect(() => {
    if (iniciado.current) return
    iniciado.current = true
    void correr()
  }, [])

  const cerrar = () => {
    if (corriendo) void api.detenerValidacion()
    onCerrar()
  }

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && cerrar()
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  })

  const hechas = pruebas.filter((p) => p.estado !== 'pendiente' && p.estado !== 'corriendo').length
  const actual = pruebas.find((p) => p.estado === 'corriendo')

  // La lista sigue a la prueba que se está revisando
  useEffect(() => {
    if (actual) document.querySelector('.modal-cuerpo .prueba.corriendo')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [actual?.id])
  const cuenta = (e: EstadoPrueba) => pruebas.filter((p) => p.estado === e).length
  const grupos = [...new Set(pruebas.map((p) => p.grupo))]
  const pct = pruebas.length ? Math.round((hechas / pruebas.length) * 100) : 0

  return (
    <div className="modal-fondo" onMouseDown={(e) => e.target === e.currentTarget && cerrar()}>
      <div className="modal validador" role="dialog" aria-modal="true" aria-labelledby="validador-titulo">
        <header className="modal-cabecera">
          <span className="modal-icono">{corriendo ? <Logo tam={34} animado /> : <EscudoCheck tam={22} />}</span>
          <div className="modal-titulos">
            <h2 id="validador-titulo">Validador</h2>
            <p>
              Revisa Taller, Ollama, tus modelos y ComfyUI en este equipo. No tienes que preparar nada: elige solo el modelo para cada prueba y trabaja en una
              carpeta temporal.
            </p>
          </div>
          <button className="icono-boton" onClick={cerrar} aria-label="Cerrar" title="Cerrar (Esc)">
            <Equis tam={16} />
          </button>
        </header>

        <div className="validacion-avance">
          <div className="barra-progreso">
            <div style={{ width: `${Math.max(pct, corriendo ? 3 : 0)}%` }} />
          </div>
          <span className={corriendo ? 'brillo-texto' : ''}>
            {corriendo
              ? `Revisando ${actual?.nombre.toLowerCase() ?? ''}… ${hechas}/${pruebas.length}`
              : informe
                ? 'Listo'
                : 'Preparando…'}
          </span>
        </div>

        <div className="modal-cuerpo">
          {grupos.map((g) => (
            <section key={g} className="grupo-pruebas">
              <h3>{g}</h3>
              {pruebas
                .filter((p) => p.grupo === g)
                .map((p, i) => {
                  const abierta = abiertas.has(p.id)
                  return (
                    <div key={p.id} className={`prueba ${p.estado}`} style={{ animationDelay: `${i * 30}ms` }}>
                      <button
                        className="prueba-fila"
                        aria-expanded={p.crudo ? abierta : undefined}
                        onClick={() =>
                          p.crudo &&
                          setAbiertas((s) => {
                            const n = new Set(s)
                            if (n.has(p.id)) n.delete(p.id)
                            else n.add(p.id)
                            return n
                          })
                        }
                        style={p.crudo ? undefined : { cursor: 'default' }}
                      >
                        <span className="prueba-icono" key={p.estado}>
                          <Icono estado={p.estado} />
                        </span>
                        <span className="prueba-texto">
                          <span className="prueba-nombre">
                            {p.nombre}
                            <span className={`etiqueta-estado ${p.estado}`}>{ETIQUETA[p.estado]}</span>
                          </span>
                          <span className="prueba-que">{p.queValida}</span>
                          {p.detalle && <span className="prueba-detalle">{p.detalle}</span>}
                        </span>
                        <span className="prueba-ms">{tiempo(p.ms)}</span>
                        <span className="prueba-mas">{p.crudo && <Derecha tam={14} className="chevron" />}</span>
                      </button>
                      {abierta && p.crudo && <pre className="prueba-crudo">{p.crudo}</pre>}
                    </div>
                  )
                })}
            </section>
          ))}
        </div>

        <footer className="modal-pie">
          <div className="resumen-validacion" aria-live="polite">
            <span className="cifra ok">{cuenta('ok')} bien</span>
            <span className="cifra aviso">{cuenta('aviso')} para revisar</span>
            <span className="cifra error">
              {cuenta('error')} {cuenta('error') === 1 ? 'falla' : 'fallas'}
            </span>
            <span className="cifra omitida">
              {cuenta('omitida')} {cuenta('omitida') === 1 ? 'omitida' : 'omitidas'}
            </span>
          </div>
          <span className="espaciador" />
          {mensaje && <span className="mensaje-guardado">{mensaje}</span>}
          {corriendo ? (
            <button className="boton" onClick={() => void api.detenerValidacion()}>
              Detener
            </button>
          ) : (
            <>
              <button className="boton" onClick={() => void correr()}>
                <Recargar tam={14} /> Volver a validar
              </button>
              <button className="boton" onClick={() => void api.abrirDatos()} title="La carpeta con tus conversaciones, por si hay que mandarla">
                <Carpeta tam={14} /> Conversaciones
              </button>
              <button
                className="boton"
                disabled={!informe}
                onClick={async () => {
                  const ruta = await api.guardarInforme(informe!.markdown)
                  setMensaje(`Guardado en ${ruta}`)
                }}
              >
                <Guardar tam={14} /> Guardar
              </button>
              <button
                className="boton primario"
                disabled={!informe}
                onClick={async () => {
                  await api.copiarTexto(informe!.markdown)
                  setMensaje('Informe copiado: pégalo en el chat')
                }}
              >
                <Copiar tam={14} /> Copiar informe
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  )
}
