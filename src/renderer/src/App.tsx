import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { aplicar } from '@shared/conversacion'
import { modeloInicial, modoPosible } from '@shared/funciones'
import type { CambiosConversacion } from '@shared/api'
import type { Ajustes, Conversacion, Entorno, Modo, ModoPermiso, ProgresoDescarga, ResumenConversacion } from '@shared/tipos'
import { BarraLateral, type Vista } from './componentes/BarraLateral'
import { Compositor } from './componentes/Compositor'
import { Carpeta } from './componentes/Iconos'
import { Logo } from './componentes/Logo'
import { VistaItem } from './componentes/Items'
import { SelectorModelo } from './componentes/SelectorModelo'
import { Tutorial } from './componentes/Tutorial'
import { Validador } from './componentes/Validador'
import { Vacio } from './componentes/Vacio'
import { VistaAjustes } from './componentes/VistaAjustes'
import { VistaModelos } from './componentes/VistaModelos'
import { api, nombreCarpeta } from './util'

interface Borrador {
  modelo?: string
  carpeta?: string
  modo: Modo
  permisos: ModoPermiso
}

const PERMISOS: { id: ModoPermiso; nombre: string; ayuda: string }[] = [
  { id: 'preguntar', nombre: 'Preguntar', ayuda: 'Pregunta antes de editar archivos o ejecutar comandos' },
  { id: 'editar', nombre: 'Auto-editar', ayuda: 'Edita archivos de la carpeta sin preguntar; los comandos sí preguntan' },
  { id: 'todo', nombre: 'Todo permitido', ayuda: 'No pregunta nada. Úsalo solo en carpetas de prueba' },
  { id: 'plan', nombre: 'Solo plan', ayuda: 'Solo mira y propone un plan; no cambia nada' }
]

export default function App() {
  const [entorno, setEntorno] = useState<Entorno | null>(null)
  const [ajustes, setAjustes] = useState<Ajustes | null>(null)
  const [lista, setLista] = useState<ResumenConversacion[]>([])
  const [conv, setConv] = useState<Conversacion | null>(null)
  const [borrador, setBorrador] = useState<Borrador>({ modo: 'agente', permisos: 'preguntar' })
  const [vista, setVista] = useState<Vista>('chat')
  const [descargas, setDescargas] = useState<Record<string, ProgresoDescarga>>({})
  const [texto, setTexto] = useState('')
  const [ocupadas, setOcupadas] = useState<Set<string>>(new Set())
  const [quieta, setQuieta] = useState(false)
  const [tutorial, setTutorial] = useState(false)
  const [validador, setValidador] = useState(false)
  const transcripcion = useRef<HTMLDivElement>(null)
  const pegado = useRef(true)

  const detectar = useCallback(async (forzar = true) => {
    const e = await api.entorno(forzar)
    setEntorno(e)
    return e
  }, [])
  const recargarLista = useCallback(async () => setLista(await api.conversaciones()), [])

  useEffect(() => {
    void (async () => {
      const inicio = Date.now()
      const [a, e, l] = await Promise.all([api.ajustes(), api.entorno(true), api.conversaciones()])
      // La pantalla de arranque se deja ver al menos un golpe del martillo
      await new Promise((r) => setTimeout(r, Math.max(0, 900 - (Date.now() - inicio))))
      setAjustes(a)
      setEntorno(e)
      setLista(l)
      setTutorial(!a.tutorialVisto)
      const modelo = modeloInicial(e, a.modeloPorDefecto)
      setBorrador({
        modelo,
        permisos: a.permisos,
        modo: modoPosible('agente', e.ollama.modelos.find((m) => m.nombre === modelo), e)
      })
    })()
  }, [])

  // Tema: «sistema» deja que mande prefers-color-scheme
  useEffect(() => {
    const raiz = document.documentElement
    if (!ajustes || ajustes.tema === 'sistema') raiz.removeAttribute('data-theme')
    else raiz.setAttribute('data-theme', ajustes.tema)
  }, [ajustes?.tema])

  // Mientras Ollama no esté, se mira seguido para detectarlo apenas lo abran
  useEffect(() => {
    const cada = entorno?.ollama.estado === 'conectado' ? 30_000 : 5_000
    const t = setInterval(() => void detectar(), cada)
    const alFoco = () => void detectar()
    window.addEventListener('focus', alFoco)
    return () => {
      clearInterval(t)
      window.removeEventListener('focus', alFoco)
    }
  }, [entorno?.ollama.estado, detectar])

  useEffect(
    () =>
      api.alEvento((id, e) => {
        setConv((c) => (c && c.id === id ? aplicar(c, e) : c))
        if (e.tipo === 'ocupada') {
          setOcupadas((s) => {
            const n = new Set(s)
            if (e.ocupada) n.add(id)
            else n.delete(id)
            return n
          })
          if (!e.ocupada) void recargarLista()
        }
        if (e.tipo === 'titulo') void recargarLista()
      }),
    [recargarLista]
  )

  useEffect(
    () =>
      api.alDescarga((p) => {
        setDescargas((d) => ({ ...d, [p.modelo]: p }))
        if (p.terminado) {
          void detectar()
          if (p.estado === 'listo') {
            setTimeout(
              () =>
                setDescargas((d) => {
                  const { [p.modelo]: _, ...resto } = d
                  return resto
                }),
              1500
            )
          }
        }
      }),
    [detectar]
  )

  const actual: Conversacion = conv ?? {
    id: '',
    titulo: 'Conversación nueva',
    creada: 0,
    actualizada: 0,
    modelo: borrador.modelo,
    carpeta: borrador.carpeta,
    modo: borrador.modo,
    permisos: borrador.permisos,
    items: [],
    tareas: [],
    ocupada: false
  }
  const modelo = entorno?.ollama.modelos.find((m) => m.nombre === actual.modelo)

  // Si aparece el primer modelo (recién descargado), se elige solo
  useEffect(() => {
    if (!entorno || modelo) return
    const inicial = modeloInicial(entorno, ajustes?.modeloPorDefecto)
    if (inicial) void cambiar({ modelo: inicial, modo: modoPosible(actual.modo, entorno.ollama.modelos.find((m) => m.nombre === inicial), entorno) })
  }, [entorno?.ollama.modelos.length])

  const cambiar = async (c: CambiosConversacion) => {
    if (conv) {
      setConv(await api.actualizar(conv.id, c))
      void recargarLista()
    } else {
      setBorrador((b) => ({
        ...b,
        ...(c.modelo !== undefined ? { modelo: c.modelo } : {}),
        ...(c.modo !== undefined ? { modo: c.modo } : {}),
        ...(c.permisos !== undefined ? { permisos: c.permisos } : {}),
        ...(c.carpeta !== undefined ? { carpeta: c.carpeta ?? undefined } : {})
      }))
    }
  }

  const cambiarModelo = (nombre: string) => {
    const m = entorno?.ollama.modelos.find((x) => x.nombre === nombre)
    void cambiar({ modelo: nombre, modo: entorno ? modoPosible(actual.modo, m, entorno) : actual.modo })
  }

  const enviar = async (textoEnvio: string, imagenes: string[], pensar: boolean) => {
    pegado.current = true
    let c = conv
    if (!c) {
      c = await api.nueva({ modelo: borrador.modelo, carpeta: borrador.carpeta, modo: borrador.modo })
      if (c.permisos !== borrador.permisos) c = await api.actualizar(c.id, { permisos: borrador.permisos })
      void recargarLista()
    }
    // Se marca ocupada ya, para que no salga un segundo envío antes de que llegue el evento
    setConv({ ...c, ocupada: true })
    await api.enviar(c.id, { texto: textoEnvio, imagenes, modo: actual.modo, pensar })
  }

  const abrir = async (id: string) => {
    setVista('chat')
    pegado.current = true
    setQuieta(true)
    setConv(await api.abrir(id))
    setTexto('')
    setTimeout(() => setQuieta(false), 500)
  }

  const abrirTutorial = () => {
    setVista('chat')
    setTutorial(true)
  }

  const cerrarTutorial = async () => {
    setTutorial(false)
    if (ajustes && !ajustes.tutorialVisto) setAjustes(await api.guardarAjustes({ ...ajustes, tutorialVisto: true }))
  }

  const nueva = () => {
    setVista('chat')
    setBorrador((b) => ({ ...b, carpeta: conv?.carpeta ?? b.carpeta, modelo: conv?.modelo ?? b.modelo, modo: conv?.modo ?? b.modo }))
    setConv(null)
    setTexto('')
  }

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        nueva()
      }
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  })

  // Baja sola mientras llega texto, salvo que el usuario haya subido a leer
  useLayoutEffect(() => {
    const el = transcripcion.current
    if (el && pegado.current) el.scrollTop = el.scrollHeight
  }, [conv?.items])

  if (!entorno || !ajustes) {
    return (
      <div className="arranque" role="status">
        <Logo tam={96} animado />
        <div className="nombre-app">Taller</div>
        <div className="arranque-texto">
          Buscando Ollama y tus modelos<span className="puntos" />
        </div>
        <div className="barra-indeterminada" />
      </div>
    )
  }

  const ultimoAsistente = [...actual.items].reverse().find((i) => i.tipo === 'asistente')?.id

  return (
    <div className="app">
      <BarraLateral
        lista={lista}
        actual={conv?.id}
        ocupadas={ocupadas}
        vista={vista}
        entorno={entorno}
        onNueva={nueva}
        onAbrir={(id) => void abrir(id)}
        onBorrar={async (id) => {
          await api.borrar(id)
          if (conv?.id === id) setConv(null)
          void recargarLista()
        }}
        onVista={setVista}
        onTutorial={abrirTutorial}
        onValidar={() => setValidador(true)}
      />
      <main className="principal">
        {vista === 'modelos' && (
          <VistaModelos
            entorno={entorno}
            modeloActual={actual.modelo}
            descargas={descargas}
            onUsar={(n) => {
              cambiarModelo(n)
              setVista('chat')
            }}
            onDetectar={() => void detectar()}
            onValidar={() => setValidador(true)}
          />
        )}
        {vista === 'ajustes' && (
          <VistaAjustes
            ajustes={ajustes}
            entorno={entorno}
            carpetaActual={actual.carpeta}
            onGuardar={async (a) => {
              setAjustes(await api.guardarAjustes(a))
              await detectar()
            }}
            onTutorial={abrirTutorial}
            onValidar={() => setValidador(true)}
          />
        )}
        {vista === 'chat' && (
          <>
            <header className="cabecera">
              <span className="titulo-conv">{actual.titulo}</span>
              <button
                className="chip"
                data-tutorial="carpeta"
                title={actual.carpeta ?? `Sin carpeta: el agente trabaja en ${ajustes.carpetaSalidas}`}
                onClick={async () => {
                  const c = await api.elegirCarpeta()
                  if (c) void cambiar({ carpeta: c })
                }}
              >
                <Carpeta tam={15} />
                <span className="recorte">{actual.carpeta ? nombreCarpeta(actual.carpeta) : 'Elegir carpeta'}</span>
              </button>
              {actual.modo === 'agente' && (
                <select
                  className="chip"
                  data-tutorial="permisos"
                  value={actual.permisos}
                  title={PERMISOS.find((p) => p.id === actual.permisos)?.ayuda}
                  onChange={(e) => void cambiar({ permisos: e.target.value as ModoPermiso })}
                  aria-label="Permisos del agente"
                >
                  {PERMISOS.map((p) => (
                    <option key={p.id} value={p.id} title={p.ayuda}>
                      {p.nombre}
                    </option>
                  ))}
                </select>
              )}
              <SelectorModelo
                entorno={entorno}
                modelo={actual.modelo}
                onElegir={cambiarModelo}
                onGestionar={() => setVista('modelos')}
                onDetectar={() => void detectar()}
              />
            </header>
            <div
              className="transcripcion"
              ref={transcripcion}
              onScroll={(e) => {
                const el = e.currentTarget
                pegado.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
              }}
            >
              {actual.items.length === 0 ? (
                <Vacio
                  entorno={entorno}
                  modelo={modelo}
                  modo={actual.modo}
                  descargas={descargas}
                  onIdea={setTexto}
                  onDetectar={() => void detectar()}
                  onIrAModelos={() => setVista('modelos')}
                />
              ) : (
                <div className={`columna ${quieta ? 'quieta' : ''}`}>
                  {actual.items.map((it) => (
                    <VistaItem
                      key={it.id}
                      it={it}
                      ultimo={it.id === ultimoAsistente && actual.items[actual.items.length - 1]?.id === it.id}
                      ocupada={actual.ocupada}
                      onResponder={(id, r) => void api.responderPermiso(id, r)}
                    />
                  ))}
                  {actual.ocupada && ['usuario', 'herramienta'].includes(actual.items[actual.items.length - 1]?.tipo) && (
                    <div className="escribiendo" aria-label="Trabajando">
                      <span />
                      <span />
                      <span />
                    </div>
                  )}
                </div>
              )}
            </div>
            <Compositor
              entorno={entorno}
              modelo={modelo}
              modo={actual.modo}
              ocupada={actual.ocupada}
              texto={texto}
              uso={actual.uso}
              tareas={actual.tareas}
              setTexto={setTexto}
              onModo={(m) => void cambiar({ modo: m })}
              onEnviar={(t, imgs, pensar) => void enviar(t, imgs, pensar)}
              onDetener={() => conv && void api.detener(conv.id)}
              onCambiarModelo={cambiarModelo}
              onIrAModelos={() => setVista('modelos')}
            />
          </>
        )}
      </main>
      {tutorial && vista === 'chat' && <Tutorial onCerrar={() => void cerrarTutorial()} onProbar={setTexto} />}
      {validador && (
        <Validador
          modeloPreferido={actual.modelo}
          onCerrar={() => {
            setValidador(false)
            void detectar()
          }}
        />
      )}
    </div>
  )
}
