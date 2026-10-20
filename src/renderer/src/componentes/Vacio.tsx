import { CATALOGO, cabe } from '@shared/catalogo'
import { disponibilidad, FUNCION_DE_MODO, FUNCIONES } from '@shared/funciones'
import type { Entorno, ModeloLocal, Modo, ProgresoDescarga } from '@shared/tipos'
import { api } from '../util'
import { Candado, Check, Descargar, Enchufe, Externo, Recargar } from './Iconos'
import { Logo } from './Logo'

const IDEAS: Record<Modo, string[]> = {
  chat: ['Explícame qué es un JWT con un ejemplo', 'Hazme un plan de estudio de Python para 4 semanas', 'Resume este texto en 5 viñetas'],
  agente: ['Explícame la estructura de este proyecto', 'Busca TODOs y hazme una lista', 'Escribe tests para la función principal'],
  imagen: ['Un taller de carpintería al atardecer, estilo acuarela', 'Logo minimalista de un colibrí en cobre', 'Póster retro de béisbol dominicano'],
  modelo3d: ['Una taza con forma de cactus', 'Un robot pequeño de juguete', 'Una figura de un gato sentado']
}

interface Props {
  entorno: Entorno
  modelo?: ModeloLocal
  modo: Modo
  descargas: Record<string, ProgresoDescarga>
  onIdea(texto: string): void
  onDetectar(): void
  onIrAModelos(): void
}

export function Vacio({ entorno, modelo, modo, descargas, onIdea, onDetectar, onIrAModelos }: Props) {
  const o = entorno.ollama
  const sinOllama = o.estado !== 'conectado'
  const sinModelos = o.estado === 'conectado' && o.modelos.filter((m) => m.capacidades.includes('completion')).length === 0

  return (
    <div className="vacio">
      {sinOllama ? (
        <BienvenidaOllama entorno={entorno} onDetectar={onDetectar} />
      ) : sinModelos ? (
        <BienvenidaModelos entorno={entorno} descargas={descargas} onIrAModelos={onIrAModelos} />
      ) : (
        <>
          <div className="fila" style={{ gap: 14 }}>
            <Logo tam={46} className="flotar" />
            <h1>¿Qué hacemos hoy?</h1>
          </div>
          <p className="sub">
            {modelo ? (
              <>
                Estás con <b>{modelo.nombre}</b>. Esto es lo que puede hacer en tu PC:
              </>
            ) : (
              'Elige un modelo arriba a la derecha.'
            )}
          </p>
        </>
      )}

      {!sinOllama && !sinModelos && (
        <div className="puede">
          {FUNCIONES.map((f) => {
            const d = disponibilidad(f.id, modelo, entorno)
            return (
              <div key={f.id} className={`capacidad ${d.activa ? '' : 'no'}`} title={d.motivo}>
                <span className="icono-c">{d.activa ? <Check tam={15} /> : <Candado tam={14} />}</span>
                <span>
                  <div className="n">{f.nombre}</div>
                  <div className="d">{d.activa ? f.descripcion : d.motivo}</div>
                </span>
              </div>
            )
          })}
        </div>
      )}

      {disponibilidad(FUNCION_DE_MODO[modo], modelo, entorno).activa && (
        <div className="sugerencias">
          {IDEAS[modo].map((t) => (
            <button key={t} className="sugerencia" onClick={() => onIdea(t)}>
              {t}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function BienvenidaOllama({ entorno, onDetectar }: { entorno: Entorno; onDetectar(): void }) {
  const o = entorno.ollama
  if (o.estado === 'apagado') {
    return (
      <div className="tarjeta">
        <div className="cabeza-tarjeta">
          <span className="radar">
            <Enchufe tam={20} />
          </span>
          <h2>Ollama está instalado, pero apagado</h2>
        </div>
        <p>Taller usa Ollama para correr los modelos en tu PC. Lo encontré en {o.ejecutable}; ábrelo y detecto tus modelos solo.</p>
        <div className="acciones">
          <button
            className="boton primario"
            onClick={async () => {
              await api.abrirOllama()
              setTimeout(onDetectar, 2500)
            }}
          >
            Abrir Ollama
          </button>
          <button className="boton" onClick={onDetectar}>
            <Recargar tam={15} /> Detectar de nuevo
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className="tarjeta">
      <div className="cabeza-tarjeta">
        <span className="radar">
          <Enchufe tam={20} />
        </span>
        <div>
          <h2>Para empezar, instala Ollama</h2>
          <span className="brillo-texto" style={{ fontSize: 12.5 }}>
            Buscándolo cada 5 segundos…
          </span>
        </div>
      </div>
      <p>
        Taller corre los modelos de IA en tu PC con <b>Ollama</b> y no lo encontré en {o.url}. Instálalo (es gratis), ábrelo y Taller lo detecta solo, con todos los
        modelos que tengas.
      </p>
      <div className="acciones">
        <button className="boton primario" onClick={() => void api.abrirExterno('https://ollama.com/download')}>
          <Externo tam={15} /> Descargar Ollama
        </button>
        <button className="boton" onClick={onDetectar}>
          <Recargar tam={15} /> Ya lo instalé, detectar
        </button>
      </div>
      <p style={{ marginTop: 12, marginBottom: 0, fontSize: 12.5 }}>¿Ollama corre en otra máquina? Cambia la dirección en Ajustes.</p>
    </div>
  )
}

function BienvenidaModelos({ entorno, descargas, onIrAModelos }: { entorno: Entorno; descargas: Record<string, ProgresoDescarga>; onIrAModelos(): void }) {
  const { vramGb, ramGb, gpu } = entorno.hardware
  const recomendados = CATALOGO.filter((m) => m.capacidades.includes('completion') && cabe(m, vramGb, ramGb)).slice(0, 3)
  return (
    <div className="tarjeta">
      <div className="cabeza-tarjeta">
        <Logo tam={40} className="flotar" />
        <h2>Ollama está listo, pero no tiene modelos</h2>
      </div>
      <p>
        {gpu ? `Tu GPU es ${gpu}${vramGb ? ` con ${vramGb} GB` : ''}.` : `No vi una GPU NVIDIA; tienes ${ramGb} GB de RAM.`} Estos te caben bien:
      </p>
      <div className="catalogo">
        {(recomendados.length ? recomendados : CATALOGO.slice(-2)).map((m) => {
          const d = descargas[m.nombre]
          const pct = d?.total ? Math.round(((d.completado ?? 0) / d.total) * 100) : 0
          return (
            <div key={m.nombre} className="sugerido">
              <div className="cab-s">
                <span className="n">{m.titulo}</span>
                <span className="tag">{m.nombre}</span>
              </div>
              <div className="para">{m.para}</div>
              {d && !d.terminado ? (
                <>
                  <div className="barra-progreso">
                    <div style={{ width: `${pct}%` }} />
                  </div>
                  <div className="pie-s">
                    <span>{d.estado}</span>
                    <span>{pct}%</span>
                  </div>
                </>
              ) : (
                <div className="pie-s">
                  <span>{m.gb} GB</span>
                  <button className="boton chico primario" onClick={() => void api.descargarModelo(m.nombre)}>
                    <Descargar tam={14} /> Descargar
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div className="acciones" style={{ marginTop: 12 }}>
        <button className="boton" onClick={onIrAModelos}>
          Ver todos los modelos
        </button>
      </div>
    </div>
  )
}
