import { useEffect, useState } from 'react'
import type { Ajustes, Entorno, ServidorMcp } from '@shared/tipos'
import { api } from '../util'
import { Carpeta, Recargar } from './Iconos'

interface Props {
  ajustes: Ajustes
  entorno: Entorno
  carpetaActual?: string
  onGuardar(a: Ajustes): Promise<void>
}

const EJEMPLO_MCP = `{
  "rea": {
    "command": "npx",
    "args": ["-y", "rea-agents@6.7.0", "mcp"]
  }
}`

export function VistaAjustes({ ajustes, entorno, carpetaActual, onGuardar }: Props) {
  const [a, setA] = useState(ajustes)
  const [mcp, setMcp] = useState(() => (Object.keys(ajustes.mcpServers).length ? JSON.stringify(ajustes.mcpServers, null, 2) : ''))
  const [errorMcp, setErrorMcp] = useState('')
  const [guardado, setGuardado] = useState(false)

  useEffect(() => setA(ajustes), [ajustes])

  const poner = <K extends keyof Ajustes>(k: K, v: Ajustes[K]) => {
    setA((x) => ({ ...x, [k]: v }))
    setGuardado(false)
  }

  const guardar = async () => {
    let servidores: Record<string, ServidorMcp> = {}
    if (mcp.trim()) {
      try {
        const leido = JSON.parse(mcp)
        servidores = leido.mcpServers ?? leido
      } catch (e) {
        setErrorMcp(`El JSON de MCP no es válido: ${(e as Error).message}`)
        return
      }
    }
    setErrorMcp('')
    await onGuardar({ ...a, mcpServers: servidores })
    setGuardado(true)
  }

  const embeddings = entorno.ollama.modelos.filter((m) => m.capacidades.includes('embedding'))
  const conversan = entorno.ollama.modelos.filter((m) => m.capacidades.includes('completion'))

  return (
    <div className="vista">
      <div className="contenido">
        <div>
          <h1>Ajustes</h1>
          <p className="bajada">Se guardan en tu PC. Nada sale a internet salvo lo que el agente busque con tu permiso.</p>
        </div>

        <section>
          <h2>Conexiones</h2>
          <div className="formulario">
            <label htmlFor="ollama">
              Dirección de Ollama <span className="ayuda-c">Normalmente http://127.0.0.1:11434</span>
            </label>
            <input id="ollama" className="campo" value={a.ollamaUrl} onChange={(e) => poner('ollamaUrl', e.target.value)} />
            <label htmlFor="comfy">
              Dirección de ComfyUI <span className="ayuda-c">Portable: 8188 · ComfyUI Desktop: 8000</span>
            </label>
            <input id="comfy" className="campo" value={a.comfyUrl} onChange={(e) => poner('comfyUrl', e.target.value)} />
          </div>
        </section>

        <section>
          <h2>Agente</h2>
          <div className="formulario">
            <label htmlFor="permisos">
              Permisos por defecto <span className="ayuda-c">Cada conversación puede cambiarlo arriba</span>
            </label>
            <select id="permisos" className="campo" value={a.permisos} onChange={(e) => poner('permisos', e.target.value as Ajustes['permisos'])}>
              <option value="preguntar">Preguntar antes de editar o ejecutar</option>
              <option value="editar">Editar archivos sin preguntar (comandos sí preguntan)</option>
              <option value="todo">Todo permitido (no pregunta nada)</option>
              <option value="plan">Plan: solo mirar, no cambia nada</option>
            </select>
            <label htmlFor="contexto">
              Contexto <span className="ayuda-c">Más contexto recuerda más, pero usa más memoria</span>
            </label>
            <select id="contexto" className="campo" value={a.contexto} onChange={(e) => poner('contexto', Number(e.target.value))}>
              {[4096, 8192, 16384, 32768, 65536, 131072].map((n) => (
                <option key={n} value={n}>
                  {n / 1024}K tokens
                </option>
              ))}
            </select>
            <label htmlFor="pasos">
              Máximo de pasos por pedido <span className="ayuda-c">Cada llamada a una herramienta es un paso</span>
            </label>
            <input id="pasos" className="campo" type="number" min={5} max={200} value={a.maxPasos} onChange={(e) => poner('maxPasos', Number(e.target.value) || 40)} />
            <label htmlFor="defecto">Modelo por defecto</label>
            <select id="defecto" className="campo" value={a.modeloPorDefecto ?? ''} onChange={(e) => poner('modeloPorDefecto', e.target.value || undefined)}>
              <option value="">El primero con herramientas</option>
              {conversan.map((m) => (
                <option key={m.nombre}>{m.nombre}</option>
              ))}
            </select>
            <label htmlFor="emb">
              Modelo de embeddings <span className="ayuda-c">Para «Buscar en documentos»</span>
            </label>
            <select id="emb" className="campo" value={a.modeloEmbeddings ?? ''} onChange={(e) => poner('modeloEmbeddings', e.target.value || undefined)}>
              <option value="">{embeddings.length ? 'El primero instalado' : 'No hay ninguno instalado'}</option>
              {embeddings.map((m) => (
                <option key={m.nombre}>{m.nombre}</option>
              ))}
            </select>
          </div>
        </section>

        <section>
          <h2>Imágenes y 3D</h2>
          <div className="formulario">
            <label htmlFor="ckimg">Checkpoint de imagen</label>
            <select id="ckimg" className="campo" value={a.checkpointImagen ?? ''} onChange={(e) => poner('checkpointImagen', e.target.value || undefined)}>
              <option value="">{entorno.comfy.checkpointsImagen.length ? 'El primero que haya' : 'ComfyUI no tiene ninguno'}</option>
              {entorno.comfy.checkpointsImagen.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <label htmlFor="ck3d">Checkpoint 3D</label>
            <select id="ck3d" className="campo" value={a.checkpoint3d ?? ''} onChange={(e) => poner('checkpoint3d', e.target.value || undefined)}>
              <option value="">{entorno.comfy.checkpoints3d.length ? 'El primero que haya' : 'ComfyUI no tiene Hunyuan3D'}</option>
              {entorno.comfy.checkpoints3d.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <label htmlFor="mejorar">
              Mejorar el prompt <span className="ayuda-c">El modelo de chat reescribe tu idea en inglés, más detallada</span>
            </label>
            <span className="interruptor">
              <input id="mejorar" type="checkbox" checked={a.mejorarPrompt} onChange={(e) => poner('mejorarPrompt', e.target.checked)} />
              {a.mejorarPrompt ? 'Activado' : 'Apagado'}
            </span>
            <label>
              Carpeta sin proyecto <span className="ayuda-c">Donde trabaja el agente y se guardan imágenes y 3D si la conversación no tiene carpeta</span>
            </label>
            <span className="fila">
              <input className="campo" value={a.carpetaSalidas} onChange={(e) => poner('carpetaSalidas', e.target.value)} />
              <button
                className="boton"
                onClick={async () => {
                  const c = await api.elegirCarpeta()
                  if (c) poner('carpetaSalidas', c)
                }}
              >
                <Carpeta tam={15} /> Elegir
              </button>
            </span>
          </div>
        </section>

        <section>
          <h2>Servidores MCP</h2>
          <p className="bajada" style={{ marginTop: -6, marginBottom: 10 }}>
            Mismo formato que <code>.mcp.json</code>: sus herramientas pasan al agente (por ejemplo REA para ingeniería inversa). Taller pregunta antes de usarlas.
          </p>
          <div className="formulario" style={{ gridTemplateColumns: '1fr' }}>
            <textarea
              className="campo"
              placeholder={EJEMPLO_MCP}
              value={mcp}
              spellCheck={false}
              onChange={(e) => {
                setMcp(e.target.value)
                setGuardado(false)
              }}
            />
            {errorMcp && <div className="aviso error">{errorMcp}</div>}
            <div className="acciones">
              {carpetaActual && (
                <button
                  className="boton chico"
                  onClick={async () => {
                    const s = await api.leerMcpProyecto(carpetaActual)
                    if (!s) return setErrorMcp('Esa carpeta no tiene un .mcp.json válido.')
                    const actuales = mcp.trim() ? JSON.parse(mcp) : {}
                    setMcp(JSON.stringify({ ...actuales, ...s }, null, 2))
                    setErrorMcp('')
                  }}
                >
                  Importar .mcp.json de la carpeta actual
                </button>
              )}
              <button className="boton chico" onClick={() => void api.recargarMcp()}>
                <Recargar tam={13} /> Reconectar
              </button>
            </div>
            {entorno.mcp.map((m) => (
              <div key={m.nombre} className="fila" style={{ fontSize: 13 }}>
                <span className={`punto ${m.estado === 'conectado' ? 'ok' : m.estado === 'error' ? 'mal' : ''}`} />
                <b>{m.nombre}</b>
                <span style={{ color: 'var(--texto-3)' }}>{m.estado === 'conectado' ? m.herramientas.join(', ') || 'sin herramientas' : (m.error ?? m.estado)}</span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2>Apariencia</h2>
          <div className="formulario">
            <label htmlFor="tema">Tema</label>
            <select id="tema" className="campo" value={a.tema} onChange={(e) => poner('tema', e.target.value as Ajustes['tema'])}>
              <option value="sistema">Igual que el sistema</option>
              <option value="claro">Claro</option>
              <option value="oscuro">Oscuro</option>
            </select>
          </div>
        </section>

        <div className="acciones">
          <button className="boton primario" onClick={guardar}>
            Guardar
          </button>
          {guardado && <span className="mensaje-guardado">Guardado. Detectando de nuevo…</span>}
        </div>
      </div>
    </div>
  )
}
