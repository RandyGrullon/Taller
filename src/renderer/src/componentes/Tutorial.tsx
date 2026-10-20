import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Logo } from './Logo'

interface Paso {
  /** Valor de `data-tutorial` del elemento a resaltar; sin objetivo, la tarjeta va al centro. */
  objetivo?: string
  titulo: string
  texto: ReactNode
  /** Si el elemento no está en pantalla (por ejemplo, Permisos fuera del modo Agente), el paso se salta. */
  opcional?: boolean
}

const PASOS: Paso[] = [
  {
    titulo: 'Bienvenido a Taller',
    texto: 'Un agente de IA que corre en tu PC con los modelos de Ollama. En un minuto te enseño dónde está todo.'
  },
  {
    objetivo: 'motores',
    titulo: 'Ollama y ComfyUI',
    texto: 'El punto verde dice que están conectados. Taller los busca solo: si instalas o abres Ollama con Taller abierto, lo detecta en segundos.'
  },
  {
    objetivo: 'modelo',
    titulo: 'Elige el modelo',
    texto: 'Cada modelo trae insignias con lo que sabe hacer: Herramientas, Visión, Razona… Desde aquí también llegas a descargar más.'
  },
  {
    objetivo: 'modos',
    titulo: 'Cuatro modos',
    texto: (
      <>
        <b>Chat</b> para preguntar, <b>Agente</b> para trabajar en tus archivos, <b>Imagen</b> y <b>3D</b> con ComfyUI. Si el modelo no puede, el modo sale con
        candado: tócalo y te digo por qué y qué modelo sí puede.
      </>
    )
  },
  {
    objetivo: 'carpeta',
    titulo: 'La carpeta de trabajo',
    texto: 'El agente lee y edita dentro de esta carpeta. Si no eliges una, trabaja en Documentos\\Taller.'
  },
  {
    objetivo: 'permisos',
    opcional: true,
    titulo: 'Cuánto puede hacer solo',
    texto: 'Preguntar, Auto-editar, Todo permitido o Solo plan. Antes de cambiar un archivo ves el diff y decides.'
  },
  {
    objetivo: 'compositor',
    titulo: 'Escribe aquí',
    texto: 'Enter envía y Shift+Enter hace un salto de línea. El clip adjunta imágenes (con modelos de Visión) y el bombillo activa Pensar. También puedes pegar o arrastrar imágenes.'
  },
  {
    objetivo: 'nueva',
    titulo: 'Tus conversaciones',
    texto: 'Ctrl+N abre una nueva. Todas quedan guardadas en tu PC, en esta lista.'
  },
  {
    objetivo: 'modelos',
    titulo: 'Modelos',
    texto: 'Descarga los modelos recomendados para tu GPU y compara en una tabla qué puede hacer cada uno.'
  },
  {
    objetivo: 'ajustes',
    titulo: 'Ajustes',
    texto: 'Direcciones de Ollama y ComfyUI, tamaño del contexto, permisos por defecto, servidores MCP (como REA) y el tema.'
  },
  {
    titulo: '¡Listo para trabajar!',
    texto: 'Puedes repetir este recorrido cuando quieras desde «Tutorial», abajo a la izquierda.'
  }
]

const ANCHO = 360
const MARGEN = 16
const HOLGURA = 8

function buscar(objetivo?: string): Element | null {
  return objetivo ? document.querySelector(`[data-tutorial="${objetivo}"]`) : null
}

interface Props {
  onCerrar(): void
  onProbar(texto: string): void
}

/** Recorrido guiado: oscurece la ventana, ilumina un elemento a la vez y explica para qué sirve. */
export function Tutorial({ onCerrar, onProbar }: Props) {
  const [pasos, setPasos] = useState(PASOS)
  const [i, setI] = useState(0)
  // Los pasos opcionales cuyo elemento no está a la vista se quitan; se mira ya montado el resto de la ventana
  useLayoutEffect(() => setPasos(PASOS.filter((p) => !p.opcional || buscar(p.objetivo))), [])
  const [caja, setCaja] = useState<DOMRect | null>(null)
  const [alto, setAlto] = useState(200)
  const tarjeta = useRef<HTMLDivElement>(null)
  const paso = pasos[i]
  const ultimo = i === pasos.length - 1

  useLayoutEffect(() => {
    const medir = () => setCaja(buscar(paso.objetivo)?.getBoundingClientRect() ?? null)
    medir()
    // Hay elementos que se animan al aparecer: se vuelve a medir un rato
    const reloj = setInterval(medir, 250)
    window.addEventListener('resize', medir)
    return () => {
      clearInterval(reloj)
      window.removeEventListener('resize', medir)
    }
  }, [paso.objetivo])

  useLayoutEffect(() => {
    if (tarjeta.current) setAlto(tarjeta.current.offsetHeight)
  }, [i])

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCerrar()
      else if (e.key === 'ArrowRight' || e.key === 'Enter') ultimo ? onCerrar() : setI((x) => x + 1)
      else if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1))
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [ultimo, onCerrar])

  const foco: CSSProperties = caja ? recuadro(caja) : { top: window.innerHeight / 2, left: window.innerWidth / 2, width: 0, height: 0 }

  return (
    <div className="tutorial" role="dialog" aria-modal="true" aria-labelledby="tutorial-titulo">
      <div className={`tutorial-foco ${caja ? '' : 'sin-objetivo'}`} style={foco} />
      <div ref={tarjeta} key={i} className={`tutorial-tarjeta ${caja ? '' : 'centrada'}`} style={posicion(caja, alto)}>
        {!caja && <Logo tam={i === 0 ? 72 : 56} animado={i === 0} className={i === 0 ? '' : 'flotar'} />}
        <div className="tutorial-paso">
          Paso {i + 1} de {pasos.length}
        </div>
        <h2 id="tutorial-titulo">{paso.titulo}</h2>
        <p>{paso.texto}</p>
        <div className="tutorial-puntos" aria-hidden>
          {pasos.map((_, j) => (
            <span key={j} className={j === i ? 'activo' : j < i ? 'visto' : ''} />
          ))}
        </div>
        <div className="tutorial-acciones">
          {i === 0 ? (
            <button className="boton" onClick={onCerrar}>
              Ahora no
            </button>
          ) : ultimo ? (
            <button
              className="boton"
              onClick={() => {
                onProbar('Explícame la estructura de este proyecto')
                onCerrar()
              }}
            >
              Probar el agente
            </button>
          ) : (
            <button className="tutorial-saltar" onClick={onCerrar}>
              Saltar
            </button>
          )}
          <span className="espaciador" />
          {i > 0 && (
            <button className="boton" onClick={() => setI(i - 1)}>
              Atrás
            </button>
          )}
          <button className="boton primario" onClick={() => (ultimo ? onCerrar() : setI(i + 1))} autoFocus>
            {i === 0 ? 'Empezar el recorrido' : ultimo ? 'Empezar a usar Taller' : 'Siguiente'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** El hueco iluminado, con holgura pero sin salirse de la ventana. */
function recuadro(caja: DOMRect): CSSProperties {
  const borde = 4
  const left = Math.max(caja.left - HOLGURA, borde)
  const top = Math.max(caja.top - HOLGURA, borde)
  const right = Math.min(caja.right + HOLGURA, window.innerWidth - borde)
  const bottom = Math.min(caja.bottom + HOLGURA, window.innerHeight - borde)
  return { left, top, width: right - left, height: bottom - top }
}

/** Debajo del elemento si cabe, si no arriba; junto a la barra lateral, a la derecha. */
function posicion(caja: DOMRect | null, alto: number): CSSProperties {
  if (!caja) return {}
  const vw = window.innerWidth
  const vh = window.innerHeight
  const ajustarX = (x: number) => Math.min(Math.max(x, MARGEN), vw - ANCHO - MARGEN)
  const ajustarY = (y: number) => Math.min(Math.max(y, MARGEN), vh - alto - MARGEN)
  // Elementos de la barra lateral (a la izquierda y angostos): la tarjeta va a su derecha
  if (caja.right < vw * 0.3) {
    return { left: caja.right + HOLGURA + MARGEN, top: ajustarY(caja.top + caja.height / 2 - alto / 2) }
  }
  const centroX = ajustarX(caja.left + caja.width / 2 - ANCHO / 2)
  if (caja.bottom + HOLGURA + MARGEN + alto < vh) return { left: centroX, top: caja.bottom + HOLGURA + MARGEN }
  return { left: centroX, top: ajustarY(caja.top - HOLGURA - MARGEN - alto) }
}
