// Servidores MCP (mismo formato que .mcp.json de otros agentes): sus herramientas entran al agente.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { EstadoMcp, ServidorMcp } from '@shared/tipos'
import type { Herramienta } from './agente/tipos'

interface Conectado {
  nombre: string
  cliente?: Client
  herramientas: { name: string; description?: string; inputSchema: Record<string, unknown> }[]
  estado: EstadoMcp['estado']
  error?: string
}

export class GestorMcp {
  private servidores = new Map<string, Conectado>()
  private firma = ''

  /** Conecta los servidores de la configuración; si no cambió, no hace nada. */
  async conectar(config: Record<string, ServidorMcp>): Promise<void> {
    const firma = JSON.stringify(config)
    if (firma === this.firma) return
    this.firma = firma
    await this.cerrar()
    await Promise.all(
      Object.entries(config).map(async ([nombre, s]) => {
        const c: Conectado = { nombre, herramientas: [], estado: 'apagado' }
        this.servidores.set(nombre, c)
        if (s.disabled) return
        try {
          const cliente = new Client({ name: 'taller', version: '0.1.0' })
          const transporte = s.url
            ? new StreamableHTTPClientTransport(new URL(s.url))
            : new StdioClientTransport({
                command: s.command ?? '',
                args: s.args ?? [],
                env: { ...getDefaultEnvironment(), ...(s.env ?? {}) },
                stderr: 'ignore'
              })
          await Promise.race([
            cliente.connect(transporte),
            new Promise((_, mal) => setTimeout(() => mal(new Error('no respondió en 30 s')), 30_000))
          ])
          const { tools } = await cliente.listTools()
          Object.assign(c, { cliente, herramientas: tools as Conectado['herramientas'], estado: 'conectado' })
        } catch (e) {
          Object.assign(c, { estado: 'error', error: (e as Error).message })
        }
      })
    )
  }

  async recargar(config: Record<string, ServidorMcp>): Promise<void> {
    this.firma = ''
    await this.conectar(config)
  }

  estado(): EstadoMcp[] {
    return [...this.servidores.values()].map((c) => ({
      nombre: c.nombre,
      estado: c.estado,
      herramientas: c.herramientas.map((t) => t.name),
      error: c.error
    }))
  }

  herramientas(): Herramienta[] {
    const lista: Herramienta[] = []
    for (const c of this.servidores.values()) {
      if (!c.cliente) continue
      const cliente = c.cliente
      for (const t of c.herramientas) {
        lista.push({
          nombre: `mcp__${c.nombre}__${t.name}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64),
          descripcion: `[MCP ${c.nombre}] ${t.description ?? t.name}`.slice(0, 1024),
          parametros: t.inputSchema ?? { type: 'object', properties: {} },
          clase: 'mcp',
          resumen: (a) => `${c.nombre} · ${t.name} ${JSON.stringify(a).slice(0, 80)}`,
          async ejecutar(a, ctx) {
            const r: any = await cliente.callTool({ name: t.name, arguments: a }, undefined, {
              signal: ctx.signal,
              timeout: 10 * 60_000
            })
            const texto = (r.content ?? [])
              .map((p: any) => (p.type === 'text' ? p.text : p.type === 'resource' ? (p.resource?.text ?? p.resource?.uri) : `[${p.type}]`))
              .join('\n')
            return { texto: texto || JSON.stringify(r.structuredContent ?? r).slice(0, 20_000), error: !!r.isError }
          }
        })
      }
    }
    return lista
  }

  async cerrar(): Promise<void> {
    await Promise.all([...this.servidores.values()].map((c) => c.cliente?.close().catch(() => undefined)))
    this.servidores.clear()
  }
}
