import { ETIQUETA_CAPACIDAD } from '@shared/funciones'
import type { Capacidad } from '@shared/tipos'

const ORDEN: Capacidad[] = ['completion', 'tools', 'vision', 'thinking', 'embedding', 'insert']

export function Insignias({ capacidades }: { capacidades: Capacidad[] }) {
  return (
    <span className="insignias">
      {ORDEN.filter((c) => capacidades.includes(c)).map((c) => (
        <span key={c} className={`insignia ${c}`}>
          {ETIQUETA_CAPACIDAD[c]}
        </span>
      ))}
    </span>
  )
}
