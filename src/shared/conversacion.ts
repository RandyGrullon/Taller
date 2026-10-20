import type { Conversacion, Evento, Item } from './tipos'

/**
 * Aplica un evento a la conversación. Lo usan los dos lados: el proceso principal
 * para guardar y la interfaz para pintar, así nunca se desincronizan.
 */
export function aplicar(c: Conversacion, e: Evento): Conversacion {
  switch (e.tipo) {
    case 'item':
      return { ...c, items: [...c.items, e.item], actualizada: Date.now() }
    case 'texto':
      return cambiarItem(c, e.itemId, (it) => (it.tipo === 'asistente' ? { ...it, texto: it.texto + e.delta } : it))
    case 'pensamiento':
      return cambiarItem(c, e.itemId, (it) =>
        it.tipo === 'asistente' ? { ...it, pensamiento: (it.pensamiento ?? '') + e.delta } : it
      )
    case 'actualizar':
      return cambiarItem(c, e.itemId, (it) => ({ ...it, ...e.cambios }) as Item)
    case 'quitar':
      return { ...c, items: c.items.filter((it) => it.id !== e.itemId) }
    case 'tareas':
      return { ...c, tareas: e.tareas }
    case 'uso':
      return { ...c, uso: { prompt: e.prompt, contexto: e.contexto } }
    case 'ocupada':
      return { ...c, ocupada: e.ocupada, actualizada: Date.now() }
    case 'titulo':
      return { ...c, titulo: e.titulo }
  }
}

function cambiarItem(c: Conversacion, id: string, f: (it: Item) => Item): Conversacion {
  let cambio = false
  const items = c.items.map((it) => {
    if (it.id !== id) return it
    cambio = true
    return f(it)
  })
  return cambio ? { ...c, items } : c
}

export function tituloDesde(texto: string): string {
  const limpio = texto.replace(/\s+/g, ' ').trim()
  if (!limpio) return 'Conversación nueva'
  return limpio.length > 48 ? limpio.slice(0, 47).trimEnd() + '…' : limpio
}

let contador = 0
export function nuevoId(prefijo = 'i'): string {
  contador = (contador + 1) % 1e6
  return `${prefijo}${Date.now().toString(36)}${contador.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}
