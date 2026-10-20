import type { Capacidad } from './tipos'

export interface ModeloSugerido {
  nombre: string
  titulo: string
  para: string
  /** Lo que se espera que traiga; al descargarlo se confirma con Ollama. */
  capacidades: Capacidad[]
  gb: number
  /** VRAM con la que corre cómodo en la GPU. */
  vramGb: number
}

// Modelos de la biblioteca de Ollama que cubren las funciones de Taller.
export const CATALOGO: ModeloSugerido[] = [
  {
    nombre: 'qwen3.5:9b',
    titulo: 'Qwen 3.5 9B',
    para: 'Todo terreno: agente, imágenes adjuntas y razonamiento',
    capacidades: ['completion', 'tools', 'vision', 'thinking'],
    gb: 6.6,
    vramGb: 8
  },
  {
    nombre: 'qwen3:8b',
    titulo: 'Qwen 3 8B',
    para: 'Agente de código liviano que razona',
    capacidades: ['completion', 'tools', 'thinking'],
    gb: 5.2,
    vramGb: 7
  },
  {
    nombre: 'qwen3:14b',
    titulo: 'Qwen 3 14B',
    para: 'Agente más capaz si tienes 12 GB de VRAM',
    capacidades: ['completion', 'tools', 'thinking'],
    gb: 9.3,
    vramGb: 11
  },
  {
    nombre: 'qwen3-vl:8b',
    titulo: 'Qwen 3 VL 8B',
    para: 'Entiende capturas, fotos y documentos escaneados',
    capacidades: ['completion', 'tools', 'vision', 'thinking'],
    gb: 6.1,
    vramGb: 8
  },
  {
    nombre: 'qwen3-coder:30b',
    titulo: 'Qwen 3 Coder 30B',
    para: 'El mejor para programar; usa GPU y RAM a la vez',
    capacidades: ['completion', 'tools'],
    gb: 19,
    vramGb: 20
  },
  {
    nombre: 'gemma3:12b',
    titulo: 'Gemma 3 12B',
    para: 'Conversa y ve imágenes, pero no usa herramientas',
    capacidades: ['completion', 'vision'],
    gb: 8.1,
    vramGb: 10
  },
  {
    nombre: 'deepseek-r1:8b',
    titulo: 'DeepSeek R1 8B',
    para: 'Razonamiento paso a paso',
    capacidades: ['completion', 'thinking'],
    gb: 5.2,
    vramGb: 7
  },
  {
    nombre: 'llama3.2:3b',
    titulo: 'Llama 3.2 3B',
    para: 'Muy liviano, para PCs sin GPU',
    capacidades: ['completion', 'tools'],
    gb: 2.0,
    vramGb: 3
  },
  {
    nombre: 'nomic-embed-text',
    titulo: 'Nomic Embed',
    para: 'Habilita «Buscar en documentos» (no conversa)',
    capacidades: ['embedding'],
    gb: 0.27,
    vramGb: 1
  }
]

/** ¿Corre entero en la GPU? Sin GPU conocida, se compara contra la mitad de la RAM. */
export function cabe(m: ModeloSugerido, vramGb?: number, ramGb?: number): boolean {
  if (vramGb) return m.vramGb <= vramGb
  return ramGb ? m.gb * 1.5 <= ramGb / 2 : true
}
