import type { LlamadaHerramienta } from '../ollama'

/**
 * Algunos modelos locales escriben la llamada a la herramienta como texto en vez de usar
 * `tool_calls` (sobre todo con plantillas viejas). Se rescatan los formatos más comunes:
 * `<tool_call>{…}</tool_call>`, un bloque ```json con {name, arguments} o el JSON suelto.
 */
export function extraerLlamadas(texto: string, nombres: string[]): { llamadas: LlamadaHerramienta[]; resto: string } {
  const llamadas: LlamadaHerramienta[] = []
  let resto = texto

  const probar = (crudo: string): boolean => {
    const ll = aLlamada(crudo, nombres)
    if (ll) llamadas.push(ll)
    return !!ll
  }

  resto = resto.replace(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g, (todo, json: string) => (probar(json) ? '' : todo))
  resto = resto.replace(/```(?:json|tool_call)?\s*(\{[\s\S]*?\})\s*```/g, (todo, json: string) => (probar(json) ? '' : todo))
  const suelto = resto.trim()
  if (!llamadas.length && suelto.startsWith('{') && suelto.endsWith('}') && probar(suelto)) resto = ''

  return { llamadas, resto: resto.trim() }
}

function aLlamada(crudo: string, nombres: string[]): LlamadaHerramienta | null {
  let obj: any
  try {
    obj = JSON.parse(crudo)
  } catch {
    return null
  }
  const nombre = obj?.name ?? obj?.function?.name ?? obj?.tool
  if (typeof nombre !== 'string' || !nombres.includes(nombre)) return null
  let args = obj.arguments ?? obj.parameters ?? obj.function?.arguments ?? obj.args ?? {}
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args)
    } catch {
      return null
    }
  }
  return { function: { name: nombre, arguments: args } }
}

/** Separa `<think>…</think>` que algunos modelos dejan dentro del contenido. */
export function separarPensamiento(texto: string): { texto: string; pensamiento: string } {
  let pensamiento = ''
  const limpio = texto.replace(/<think>([\s\S]*?)(<\/think>|$)/g, (_, p: string) => {
    pensamiento += p
    return ''
  })
  return { texto: limpio.trim(), pensamiento: pensamiento.trim() }
}
