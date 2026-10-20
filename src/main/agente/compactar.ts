import type { Mensaje, Ollama } from '../ollama'
import { recortar } from './herramientas'

/** Se compacta cuando el último pedido ya usó más del 80 % de la ventana. */
export function debeCompactar(tokensPrompt: number, contexto: number): boolean {
  return tokensPrompt > contexto * 0.8
}

/** Texto plano de la conversación para que el modelo la resuma. */
export function transcribir(historial: Mensaje[], maxCaracteres: number): string {
  const partes = historial.map((m) => {
    if (m.role === 'tool') return `[resultado de ${m.tool_name}]\n${recortar(m.content, 1500)}`
    const llamadas = (m.tool_calls ?? []).map((c) => `[llama a ${c.function.name} ${JSON.stringify(c.function.arguments).slice(0, 300)}]`)
    const quien = m.role === 'user' ? 'Usuario' : m.role === 'assistant' ? 'Asistente' : 'Sistema'
    return `${quien}: ${[m.content, ...llamadas].filter(Boolean).join('\n')}`
  })
  const texto = partes.join('\n\n')
  // Si no cabe se conserva el final, que es lo más reciente
  return texto.length > maxCaracteres ? '[…]\n' + texto.slice(-maxCaracteres) : texto
}

/**
 * Resume todo lo anterior al último mensaje del usuario y lo reemplaza por ese resumen.
 * Devuelve el historial nuevo; lo que viene desde el último pedido se deja intacto.
 */
export async function compactar(
  ollama: Ollama,
  modelo: string,
  historial: Mensaje[],
  contexto: number,
  signal?: AbortSignal
): Promise<Mensaje[]> {
  let corte = historial.length - 1
  while (corte > 0 && historial[corte].role !== 'user') corte--
  const viejo = historial.slice(0, corte)
  if (viejo.length < 2) return historial
  const r = await ollama.chat(
    {
      model: modelo,
      messages: [
        {
          role: 'system',
          content:
            'Resume la conversación para poder seguir trabajando sin ella. Incluye: lo que pidió el usuario, decisiones tomadas, archivos tocados (rutas), comandos importantes y su resultado, y lo que queda pendiente. Usa viñetas. Máximo 300 palabras.'
        },
        { role: 'user', content: transcribir(viejo, Math.floor(contexto * 2.5)) }
      ],
      options: { num_ctx: contexto, temperature: 0.2 }
    },
    () => undefined,
    signal
  )
  return [
    { role: 'user', content: `Resumen de lo hablado antes (se compactó para ahorrar contexto):\n\n${r.content.trim()}` },
    { role: 'assistant', content: 'Entendido, sigo desde ahí.' },
    ...historial.slice(corte)
  ]
}
