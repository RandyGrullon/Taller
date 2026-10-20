// Detecta Ollama (corriendo, apagado o sin instalar), la GPU y la RAM.
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { totalmem } from 'node:os'
import { join } from 'node:path'
import type { EstadoOllama, Hardware } from '@shared/tipos'
import { Ollama } from './ollama'

export function rutasOllama(): string[] {
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA ?? ''
    return [
      join(local, 'Programs', 'Ollama', 'ollama app.exe'),
      join(local, 'Programs', 'Ollama', 'ollama.exe'),
      join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Ollama', 'ollama.exe')
    ]
  }
  if (process.platform === 'darwin') return ['/Applications/Ollama.app', '/usr/local/bin/ollama', '/opt/homebrew/bin/ollama']
  return ['/usr/local/bin/ollama', '/usr/bin/ollama', '/snap/bin/ollama']
}

export async function detectarOllama(url: string, cliente = new Ollama(url)): Promise<EstadoOllama> {
  try {
    const version = await cliente.version()
    const modelos = await cliente.modelos()
    modelos.sort((a, b) => a.nombre.localeCompare(b.nombre))
    return { estado: 'conectado', url, version, modelos }
  } catch (e) {
    const ejecutable = rutasOllama().find((r) => existsSync(r))
    return {
      estado: ejecutable ? 'apagado' : 'no-instalado',
      url,
      modelos: [],
      ejecutable,
      error: (e as Error).message
    }
  }
}

/** Arranca Ollama si está instalado pero apagado. */
export function abrirOllama(ejecutable: string): void {
  if (process.platform === 'darwin' && ejecutable.endsWith('.app')) {
    spawn('open', ['-a', ejecutable], { detached: true, stdio: 'ignore' }).unref()
    return
  }
  const args = ejecutable.toLowerCase().endsWith('ollama app.exe') ? [] : ['serve']
  spawn(ejecutable, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref()
}

let hardwareGuardado: Hardware | null = null

export async function detectarHardware(): Promise<Hardware> {
  if (hardwareGuardado) return hardwareGuardado
  const ramGb = Math.round((totalmem() / 2 ** 30) * 10) / 10
  const gpu = await new Promise<{ gpu?: string; vramGb?: number }>((ok) => {
    execFile(
      'nvidia-smi',
      ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'],
      { timeout: 4000, windowsHide: true },
      (err, salida) => {
        if (err || !salida.trim()) return ok({})
        const [nombre, mb] = salida.trim().split('\n')[0].split(',').map((s) => s.trim())
        ok({ gpu: nombre, vramGb: Math.round((Number(mb) / 1024) * 10) / 10 || undefined })
      }
    )
  })
  hardwareGuardado = { ...gpu, ramGb, so: process.platform }
  return hardwareGuardado
}
