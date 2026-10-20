import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ModoPermiso } from '@shared/tipos'
import { shellDelSistema } from './herramientas'

const ARCHIVOS_MEMORIA = ['TALLER.md', 'AGENTS.md', 'CLAUDE.md']

/** Instrucciones del proyecto: el primero que exista de TALLER.md, AGENTS.md o CLAUDE.md. */
export async function memoriaDelProyecto(carpeta?: string): Promise<{ archivo: string; texto: string } | null> {
  if (!carpeta) return null
  for (const archivo of ARCHIVOS_MEMORIA) {
    const texto = await readFile(join(carpeta, archivo), 'utf8').catch(() => null)
    if (texto?.trim()) return { archivo, texto: texto.length > 12_000 ? texto.slice(0, 12_000) + '\n[…recortado]' : texto }
  }
  return null
}

export interface DatosSistema {
  modelo: string
  carpeta?: string
  conHerramientas: boolean
  modoPermiso: ModoPermiso
  herramientas: string[]
  memoria?: { archivo: string; texto: string } | null
  fecha?: Date
}

export function promptDeSistema(d: DatosSistema): string {
  const fecha = (d.fecha ?? new Date()).toISOString().slice(0, 10)
  const so = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[process.platform as string] ?? process.platform
  const partes: string[] = []

  if (!d.conHerramientas) {
    partes.push(
      `Eres Taller, un asistente de IA que corre en local en la computadora del usuario con el modelo ${d.modelo} de Ollama.`,
      'Responde en el idioma del usuario (español por defecto), claro y al grano. Usa Markdown cuando ayude: listas, tablas y bloques de código con su lenguaje.',
      'Si no sabes algo o no estás seguro, dilo. No inventes datos, rutas ni resultados.',
      `Fecha de hoy: ${fecha}. Sistema: ${so}.`
    )
  } else {
    partes.push(
      `Eres Taller, un agente de programación que corre en local en la computadora del usuario con el modelo ${d.modelo} de Ollama. Trabajas dentro de una carpeta del usuario con herramientas para leer y editar archivos, buscar, ejecutar comandos y más.`,
      '',
      '# Entorno',
      `- Carpeta de trabajo: ${d.carpeta}`,
      `- Sistema: ${so} · shell: ${shellDelSistema().nombre}`,
      `- Fecha: ${fecha}`,
      `- Herramientas: ${d.herramientas.join(', ')}`,
      '',
      '# Cómo trabajar',
      '- Responde en el idioma del usuario (español por defecto). Sé breve: nada de relleno ni repetir lo que pediste.',
      '- Antes de afirmar algo sobre el proyecto, míralo con las herramientas. Nunca inventes el contenido de un archivo.',
      '- Lee un archivo antes de editarlo. Para cambios puntuales usa edit_file con un fragmento exacto y único; write_file solo para archivos nuevos o reescrituras completas.',
      '- Las rutas son relativas a la carpeta de trabajo.',
      '- Imita el estilo del código que ya existe: nombres, comentarios, formato.',
      '- Para trabajos de varios pasos usa todo_write y ve marcando el avance.',
      '- Después de cambiar código, comprueba que funciona (tests, build o ejecutarlo) si el proyecto lo permite.',
      '- Si una herramienta falla, lee el error y corrige el rumbo; no repitas la misma llamada.',
      '- No ejecutes comandos destructivos (borrar, git push --force, reset) a menos que el usuario lo pida.',
      '- Llama una herramienta a la vez cuando una dependa de otra. Al terminar, di en una o dos frases qué hiciste y qué falta.'
    )
    if (d.modoPermiso === 'plan') {
      partes.push(
        '',
        '# Modo plan',
        'Estás en modo plan: solo puedes mirar. Investiga lo necesario y entrega un plan concreto (archivos y pasos). No intentes modificar nada.'
      )
    }
  }

  if (d.memoria) {
    partes.push('', `# Instrucciones del proyecto (${d.memoria.archivo})`, d.memoria.texto.trim())
  }
  return partes.join('\n')
}

export const PROMPT_SUBAGENTE =
  'Eres un subagente de investigación de Taller. Solo puedes leer: usa las herramientas para encontrar lo que te piden y responde con un resumen concreto, con rutas y números de línea. No propongas cambios que no te pidieron.'
