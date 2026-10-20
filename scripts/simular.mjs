// Levanta Ollama y ComfyUI simulados para probar Taller en una PC sin GPU.
//   npm run simular                  → 11434 y 8188, con modelos
//   npm run simular -- --vacio       → Ollama sin modelos (pantalla de bienvenida)
//   npm run simular -- --sin-comfy   → solo Ollama
import { crearComfySimulado } from './comfyui-simulado.mjs'
import { crearOllamaSimulado } from './ollama-simulado.mjs'

const arg = (n, d) => {
  const i = process.argv.indexOf(n)
  return i >= 0 ? process.argv[i + 1] : d
}
const pOllama = Number(arg('--ollama', 11434))
const pComfy = Number(arg('--comfy', 8188))

function escuchar(servidor, puerto, nombre) {
  servidor.on('error', (e) => {
    console.error(e.code === 'EADDRINUSE' ? `${nombre}: el puerto ${puerto} está ocupado (¿ya corre el de verdad?).` : `${nombre}: ${e.message}`)
    process.exit(1)
  })
  servidor.listen(puerto, '127.0.0.1', () => console.log(`${nombre} simulado en http://127.0.0.1:${puerto}`))
}

escuchar(crearOllamaSimulado({ vacio: process.argv.includes('--vacio') }), pOllama, 'Ollama')
if (!process.argv.includes('--sin-comfy')) escuchar(crearComfySimulado({ sin3d: process.argv.includes('--sin-3d') }), pComfy, 'ComfyUI')
console.log('Abre Taller con «npm run dev». Ctrl+C para parar.')
