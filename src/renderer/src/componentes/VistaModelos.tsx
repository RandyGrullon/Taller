import { useState } from 'react'
import { CATALOGO, cabe } from '@shared/catalogo'
import { disponibilidad, FUNCIONES, tiene } from '@shared/funciones'
import type { Entorno, ProgresoDescarga } from '@shared/tipos'
import { api, gb } from '../util'
import { Basura, Candado, Check, Descargar, Equis, EscudoCheck, Externo, Recargar } from './Iconos'
import { Insignias } from './Insignias'

interface Props {
  entorno: Entorno
  modeloActual?: string
  descargas: Record<string, ProgresoDescarga>
  onUsar(nombre: string): void
  onDetectar(): void
  onValidar(): void
}

export function VistaModelos({ entorno, modeloActual, descargas, onUsar, onDetectar, onValidar }: Props) {
  const [otro, setOtro] = useState('')
  const o = entorno.ollama
  const c = entorno.comfy
  const h = entorno.hardware
  const instalados = new Set(o.modelos.map((m) => m.nombre))
  const columnas = FUNCIONES.filter((f) => f.motor === 'modelo')

  return (
    <div className="vista">
      <div className="contenido">
        <div>
          <h1>Modelos y motores</h1>
          <p className="bajada">Cada modelo dice qué sabe hacer; Taller activa o bloquea las funciones según eso.</p>
        </div>

        <section>
          <div className="fila" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
            <h2 style={{ margin: 0 }}>Motores</h2>
            <span className="fila">
              <button className="boton chico" onClick={onDetectar}>
                <Recargar tam={14} /> Volver a detectar
              </button>
              <button className="boton chico primario" onClick={onValidar}>
                <EscudoCheck tam={14} /> Validar todo
              </button>
            </span>
          </div>
          <div className="rejilla-motores">
            <div className="motor">
              <span className="n">
                <span className={`punto ${o.estado === 'conectado' ? 'ok' : o.estado === 'apagado' ? 'medio' : 'mal'}`} /> Ollama
              </span>
              <span className="d">
                {o.estado === 'conectado'
                  ? `v${o.version} · ${o.modelos.length} modelo${o.modelos.length === 1 ? '' : 's'}`
                  : o.estado === 'apagado'
                    ? 'Instalado, pero apagado'
                    : 'No está instalado'}
              </span>
              <span className="d" style={{ color: 'var(--texto-3)' }}>
                {o.url}
              </span>
            </div>
            <div className="motor">
              <span className="n">
                <span className={`punto ${c.conectado ? (c.checkpointsImagen.length || c.checkpoints3d.length ? 'ok' : 'medio') : 'mal'}`} /> ComfyUI
              </span>
              <span className="d">{c.conectado ? c.mensaje : 'No responde'}</span>
              <span className="d" style={{ color: 'var(--texto-3)' }}>
                {c.conectado
                  ? `Imagen: ${c.checkpointsImagen.length ? c.checkpointsImagen.length + ' checkpoint(s)' : 'ninguno'} · 3D: ${c.nodos3d && c.checkpoints3d.length ? 'Hunyuan3D listo' : 'no'}`
                  : c.url}
              </span>
            </div>
            <div className="motor">
              <span className="n">
                <span className={`punto ${h.gpu ? 'ok' : 'medio'}`} /> Tu equipo
              </span>
              <span className="d">{h.gpu ? `${h.gpu}${h.vramGb ? ` · ${h.vramGb} GB VRAM` : ''}` : 'Sin GPU NVIDIA detectada'}</span>
              <span className="d" style={{ color: 'var(--texto-3)' }}>
                {h.ramGb} GB de RAM
              </span>
            </div>
            <div className="motor">
              <span className="n">
                <span className={`punto ${entorno.mcp.some((m) => m.estado === 'conectado') ? 'ok' : entorno.mcp.some((m) => m.estado === 'error') ? 'mal' : ''}`} /> Servidores MCP
              </span>
              <span className="d">
                {entorno.mcp.length
                  ? entorno.mcp.map((m) => `${m.nombre}: ${m.estado === 'conectado' ? `${m.herramientas.length} herramientas` : m.estado === 'error' ? 'error' : 'apagado'}`).join(' · ')
                  : 'Ninguno configurado (Ajustes)'}
              </span>
            </div>
          </div>
        </section>

        <section>
          <h2>Lo que puede hacer cada modelo instalado</h2>
          {o.modelos.length === 0 ? (
            <div className="tarjeta">
              <p style={{ margin: 0 }}>{o.estado === 'conectado' ? 'Ollama no tiene modelos. Descarga uno de abajo.' : 'Cuando Ollama esté corriendo, aquí salen tus modelos.'}</p>
            </div>
          ) : (
            <table className="matriz">
              <thead>
                <tr>
                  <th>Modelo</th>
                  {columnas.map((f) => (
                    <th key={f.id}>{f.nombre}</th>
                  ))}
                  <th>Documentos</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {o.modelos.map((m) => (
                  <tr key={m.nombre}>
                    <td>
                      <div className="nombre-m">{m.nombre}</div>
                      <div className="meta-m">
                        {[m.parametros, m.cuantizacion, gb(m.tamano), m.contexto ? `${Math.round(m.contexto / 1024)}K contexto` : ''].filter(Boolean).join(' · ')}
                      </div>
                      <div style={{ marginTop: 4 }}>
                        <Insignias capacidades={m.capacidades} />
                      </div>
                    </td>
                    {columnas.map((f) => (
                      <td key={f.id} className={tiene(m, f.requiere) ? 'si' : 'no'} title={disponibilidad(f.id, m, entorno).motivo}>
                        {tiene(m, f.requiere) ? <Check tam={16} /> : <Candado tam={14} />}
                      </td>
                    ))}
                    <td className={disponibilidad('documentos', m, entorno).activa ? 'si' : 'no'} title={disponibilidad('documentos', m, entorno).motivo}>
                      {disponibilidad('documentos', m, entorno).activa ? <Check tam={16} /> : <Candado tam={14} />}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {m.capacidades.includes('completion') && (
                        <button className="boton chico" disabled={m.nombre === modeloActual} onClick={() => onUsar(m.nombre)}>
                          {m.nombre === modeloActual ? 'En uso' : 'Usar'}
                        </button>
                      )}{' '}
                      <button
                        className="boton chico peligro"
                        title="Borrar de Ollama"
                        aria-label={`Borrar ${m.nombre}`}
                        onClick={async () => {
                          if (!confirm(`¿Borrar ${m.nombre} de Ollama? Libera ${gb(m.tamano)}; lo puedes volver a descargar.`)) return
                          await api.borrarModelo(m.nombre)
                          onDetectar()
                        }}
                      >
                        <Basura tam={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="bajada" style={{ fontSize: 12.5 }}>
            Imágenes y 3D no dependen del modelo de chat sino de ComfyUI: {disponibilidad('imagen', undefined, entorno).activa ? 'imágenes listas' : 'imágenes no disponibles'} ·{' '}
            {disponibilidad('modelo3d', undefined, entorno).activa ? '3D listo' : '3D no disponible'}.
          </p>
        </section>

        <section>
          <h2>Para descargar</h2>
          <div className="catalogo">
            {CATALOGO.map((m) => {
              const d = descargas[m.nombre]
              const pct = d?.total ? Math.round(((d.completado ?? 0) / d.total) * 100) : 0
              const ya = instalados.has(m.nombre)
              const entra = cabe(m, h.vramGb, h.ramGb)
              return (
                <div key={m.nombre} className="sugerido">
                  <div className="cab-s">
                    <span className="n">{m.titulo}</span>
                    <span className="tag">{m.nombre}</span>
                  </div>
                  <div className="para">{m.para}</div>
                  <Insignias capacidades={m.capacidades} />
                  {d && !d.terminado ? (
                    <>
                      <div className="barra-progreso">
                        <div style={{ width: `${pct}%` }} />
                      </div>
                      <div className="pie-s">
                        <span>
                          {d.estado} {pct ? `· ${pct}%` : ''}
                        </span>
                        <button className="boton chico" onClick={() => void api.cancelarDescarga(m.nombre)}>
                          <Equis tam={13} /> Cancelar
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="pie-s">
                      <span>
                        {m.gb} GB · <span className={entra ? 'cabe' : 'no-cabe'}>{entra ? 'Te cabe bien' : 'Pesado para tu equipo'}</span>
                        {d?.error && <span style={{ color: 'var(--error)' }}> · {d.error}</span>}
                      </span>
                      {ya ? (
                        <span className="cabe">Instalado</span>
                      ) : (
                        <button className="boton chico primario" disabled={o.estado !== 'conectado'} onClick={() => void api.descargarModelo(m.nombre)}>
                          <Descargar tam={14} /> Descargar
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        <section>
          <h2>Otro modelo de la biblioteca de Ollama</h2>
          <div className="fila">
            <input className="campo" style={{ maxWidth: 360 }} placeholder="por ejemplo qwen3:4b o mistral-small3.2" value={otro} onChange={(e) => setOtro(e.target.value)} />
            <button
              className="boton primario"
              disabled={!otro.trim() || o.estado !== 'conectado'}
              onClick={() => {
                void api.descargarModelo(otro.trim())
                setOtro('')
              }}
            >
              <Descargar tam={14} /> Descargar
            </button>
            <button className="boton" onClick={() => void api.abrirExterno('https://ollama.com/library')}>
              <Externo tam={14} /> Ver biblioteca
            </button>
          </div>
          {Object.values(descargas)
            .filter((d) => !CATALOGO.some((m) => m.nombre === d.modelo))
            .map((d) => (
              <p key={d.modelo} className="bajada" style={{ fontSize: 12.5 }}>
                {d.modelo}: {d.error ?? d.estado}
                {d.total ? ` · ${Math.round(((d.completado ?? 0) / d.total) * 100)}%` : ''}
              </p>
            ))}
        </section>
      </div>
    </div>
  )
}
