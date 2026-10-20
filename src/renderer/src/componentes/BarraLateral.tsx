import type { Entorno, ResumenConversacion } from '@shared/tipos'
import { agrupar } from '../util'
import { Basura, Capas, Engranaje, Mas } from './Iconos'
import { Logo } from './Logo'

export type Vista = 'chat' | 'modelos' | 'ajustes'

interface Props {
  lista: ResumenConversacion[]
  actual?: string
  ocupadas: Set<string>
  vista: Vista
  entorno: Entorno | null
  onNueva(): void
  onAbrir(id: string): void
  onBorrar(id: string): void
  onVista(v: Vista): void
}

export function BarraLateral(p: Props) {
  const o = p.entorno?.ollama
  const c = p.entorno?.comfy
  return (
    <aside className="lateral">
      <div className="marca">
        <Logo tam={28} /> Taller
      </div>
      <button className="boton-nueva" onClick={p.onNueva}>
        <Mas /> Nueva conversación
      </button>
      <nav className="lista-conversaciones" aria-label="Conversaciones">
        {agrupar(p.lista).map((g) => (
          <div key={g.titulo}>
            <div className="grupo-titulo">{g.titulo}</div>
            {g.items.map((c, i) => (
              <div
                key={c.id}
                role="button"
                tabIndex={0}
                style={{ animationDelay: `${Math.min(i, 10) * 25}ms` }}
                className={`conversacion ${p.vista === 'chat' && c.id === p.actual ? 'activa' : ''}`}
                onClick={() => p.onAbrir(c.id)}
                onKeyDown={(e) => e.key === 'Enter' && p.onAbrir(c.id)}
                title={c.carpeta ? `${c.titulo}\n${c.carpeta}` : c.titulo}
              >
                <span className="titulo">{c.titulo}</span>
                {p.ocupadas.has(c.id) && <span className="ocupada" aria-label="Trabajando" />}
                <button
                  className="borrar"
                  aria-label="Borrar conversación"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (confirm(`¿Borrar «${c.titulo}»?`)) p.onBorrar(c.id)
                  }}
                >
                  <Basura tam={14} />
                </button>
              </div>
            ))}
          </div>
        ))}
        {p.lista.length === 0 && <div className="grupo-titulo">Todavía no hay conversaciones</div>}
      </nav>
      <div className="pie-lateral">
        <div className="motores">
          <span className="pildora" title={o?.error ?? o?.url}>
            <span className={`punto ${o?.estado === 'conectado' ? 'ok' : o?.estado === 'apagado' ? 'medio' : 'mal'}`} />
            Ollama{o?.estado === 'conectado' ? ` · ${o.modelos.length}` : ''}
          </span>
          <span className="pildora" title={c?.mensaje}>
            <span className={`punto ${c?.conectado ? 'ok' : ''}`} />
            ComfyUI
          </span>
        </div>
        <button className={`enlace-lateral ${p.vista === 'modelos' ? 'activa' : ''}`} onClick={() => p.onVista('modelos')}>
          <Capas /> Modelos
        </button>
        <button className={`enlace-lateral ${p.vista === 'ajustes' ? 'activa' : ''}`} onClick={() => p.onVista('ajustes')}>
          <Engranaje /> Ajustes
        </button>
      </div>
    </aside>
  )
}
