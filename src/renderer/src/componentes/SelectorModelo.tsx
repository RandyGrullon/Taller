import { useEffect, useRef, useState } from 'react'
import type { Entorno } from '@shared/tipos'
import { gb } from '../util'
import { Abajo, Capas, Recargar } from './Iconos'
import { Insignias } from './Insignias'

interface Props {
  entorno: Entorno
  modelo?: string
  onElegir(nombre: string): void
  onGestionar(): void
  onDetectar(): void
}

export function SelectorModelo({ entorno, modelo, onElegir, onGestionar, onDetectar }: Props) {
  const [abierto, setAbierto] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const actual = entorno.ollama.modelos.find((m) => m.nombre === modelo)

  useEffect(() => {
    if (!abierto) return
    const fuera = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setAbierto(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setAbierto(false)
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', fuera)
      document.removeEventListener('keydown', esc)
    }
  }, [abierto])

  const conversan = entorno.ollama.modelos.filter((m) => m.capacidades.includes('completion'))
  const otros = entorno.ollama.modelos.filter((m) => !m.capacidades.includes('completion'))

  return (
    <div className="selector" ref={ref} data-tutorial="modelo">
      <button className="chip selector-boton" onClick={() => setAbierto(!abierto)} aria-expanded={abierto} title="Modelo de esta conversación">
        <span className="recorte">
          {actual ? <span className="nombre">{actual.nombre}</span> : <span>{entorno.ollama.modelos.length ? 'Elige un modelo' : 'Sin modelos'}</span>}
        </span>
        <Abajo tam={14} />
      </button>
      {abierto && (
        <div className="menu" role="listbox">
          {conversan.length > 0 && <div className="menu-titulo">Modelos instalados en Ollama</div>}
          {conversan.map((m) => (
            <button
              key={m.nombre}
              role="option"
              aria-selected={m.nombre === modelo}
              className={`opcion-modelo ${m.nombre === modelo ? 'elegido' : ''}`}
              onClick={() => {
                onElegir(m.nombre)
                setAbierto(false)
              }}
            >
              <span className="nombre">{m.nombre}</span>
              <span className="detalle">
                {[m.parametros, gb(m.tamano)].filter(Boolean).join(' · ')}
              </span>
              <span className="insignias">
                <Insignias capacidades={m.capacidades} />
              </span>
            </button>
          ))}
          {otros.length > 0 && (
            <>
              <div className="menu-titulo">Solo embeddings (para «Buscar en documentos»)</div>
              {otros.map((m) => (
                <div key={m.nombre} className="opcion-modelo" style={{ cursor: 'default' }}>
                  <span className="nombre" style={{ color: 'var(--texto-3)' }}>
                    {m.nombre}
                  </span>
                  <span className="detalle">{gb(m.tamano)}</span>
                  <span className="insignias">
                    <Insignias capacidades={m.capacidades} />
                  </span>
                </div>
              ))}
            </>
          )}
          {entorno.ollama.modelos.length === 0 && (
            <div className="menu-titulo">{entorno.ollama.estado === 'conectado' ? 'Ollama no tiene modelos todavía.' : 'Ollama no está corriendo.'}</div>
          )}
          <div className="menu-pie">
            <button
              onClick={() => {
                onGestionar()
                setAbierto(false)
              }}
            >
              <Capas /> Descargar y comparar modelos
            </button>
            <button onClick={onDetectar}>
              <Recargar /> Volver a detectar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
