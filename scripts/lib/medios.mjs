// PNG y GLB hechos a mano para los simuladores (sin dependencias).
import { deflateSync } from 'node:zlib'

const TABLA_CRC = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = TABLA_CRC[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function trozo(tipo, datos) {
  const largo = Buffer.alloc(4)
  largo.writeUInt32BE(datos.length)
  const td = Buffer.concat([Buffer.from(tipo, 'ascii'), datos])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([largo, td, crc])
}

export function semilla(texto) {
  let h = 2166136261
  for (const ch of String(texto)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return h >>> 0
}

function azar(s) {
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0
    return s / 2 ** 32
  }
}

/** Una imagen "pintada" a partir del prompt: degradado, sol y colinas. */
export function png(prompt, ancho = 512, alto = 512) {
  const r = azar(semilla(prompt))
  const tono = r() * 360
  const hsl = (h, s, l) => {
    const a = s * Math.min(l, 1 - l)
    const f = (n) => {
      const k = (n + h / 30) % 12
      return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
    }
    return [f(0), f(8), f(4)]
  }
  const cielo1 = hsl(tono, 0.6, 0.78)
  const cielo2 = hsl((tono + 40) % 360, 0.55, 0.55)
  const sol = hsl((tono + 180) % 360, 0.8, 0.62)
  const colina = hsl((tono + 90) % 360, 0.35, 0.32)
  const sx = ancho * (0.25 + r() * 0.5)
  const sy = alto * (0.25 + r() * 0.15)
  const radio = ancho * (0.09 + r() * 0.06)
  const filas = []
  for (let y = 0; y < alto; y++) {
    const fila = Buffer.alloc(1 + ancho * 3)
    const t = y / alto
    for (let x = 0; x < ancho; x++) {
      let c = cielo1.map((v, i) => v + (cielo2[i] - v) * t)
      if ((x - sx) ** 2 + (y - sy) ** 2 < radio ** 2) c = sol
      const borde = alto * 0.68 + Math.sin(x / (ancho / 6) + tono) * alto * 0.06 + Math.sin(x / (ancho / 17)) * alto * 0.015
      if (y > borde) c = colina.map((v) => v * (0.85 + 0.15 * (1 - (y - borde) / alto)))
      fila[1 + x * 3] = c[0]
      fila[2 + x * 3] = c[1]
      fila[3 + x * 3] = c[2]
    }
    filas.push(fila)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(ancho, 0)
  ihdr.writeUInt32BE(alto, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo('IHDR', ihdr),
    trozo('IDAT', deflateSync(Buffer.concat(filas))),
    trozo('IEND', Buffer.alloc(0))
  ])
}

/** Una "gota" 3D: esfera deformada según la semilla, en GLB. */
export function glb(texto) {
  const r = azar(semilla(texto))
  const [a, b, c] = [r() * 3 + 2, r() * 3 + 2, r() * 6]
  const pos = []
  const nor = []
  const idx = []
  const N = 48
  const M = 32
  for (let i = 0; i <= M; i++) {
    const th = (i / M) * Math.PI
    for (let j = 0; j <= N; j++) {
      const ph = (j / N) * Math.PI * 2
      const k = 1 + 0.18 * Math.sin(a * th + c) * Math.cos(b * ph) + 0.08 * Math.sin(5 * ph)
      const x = Math.sin(th) * Math.cos(ph)
      const y = Math.cos(th)
      const z = Math.sin(th) * Math.sin(ph)
      pos.push(x * k, y * k * 1.15, z * k)
      nor.push(x, y, z)
    }
  }
  for (let i = 0; i < M; i++) {
    for (let j = 0; j < N; j++) {
      const p = i * (N + 1) + j
      idx.push(p, p + N + 1, p + 1, p + 1, p + N + 1, p + N + 2)
    }
  }
  const posBuf = Buffer.from(new Float32Array(pos).buffer)
  const norBuf = Buffer.from(new Float32Array(nor).buffer)
  const idxBuf = Buffer.from(new Uint32Array(idx).buffer)
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < pos.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], pos[i + k])
      max[k] = Math.max(max[k], pos[i + k])
    }
  }
  const bin = Buffer.concat([posBuf, norBuf, idxBuf])
  const json = {
    asset: { version: '2.0', generator: 'Taller (simulado)' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2 }] }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBuf.length, target: 34962 },
      { buffer: 0, byteOffset: posBuf.length, byteLength: norBuf.length, target: 34962 },
      { buffer: 0, byteOffset: posBuf.length + norBuf.length, byteLength: idxBuf.length, target: 34963 }
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: pos.length / 3, type: 'VEC3', min, max },
      { bufferView: 1, componentType: 5126, count: nor.length / 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5125, count: idx.length, type: 'SCALAR' }
    ]
  }
  let jsonBuf = Buffer.from(JSON.stringify(json))
  if (jsonBuf.length % 4) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(4 - (jsonBuf.length % 4), 0x20)])
  const binPad = bin.length % 4 ? Buffer.concat([bin, Buffer.alloc(4 - (bin.length % 4))]) : bin
  const cab = Buffer.alloc(12)
  cab.write('glTF', 0, 'ascii')
  cab.writeUInt32LE(2, 4)
  cab.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binPad.length, 8)
  const cj = Buffer.alloc(8)
  cj.writeUInt32LE(jsonBuf.length, 0)
  cj.write('JSON', 4, 'ascii')
  const cb = Buffer.alloc(8)
  cb.writeUInt32LE(binPad.length, 0)
  cb.write('BIN\0', 4, 'ascii')
  return Buffer.concat([cab, cj, jsonBuf, cb, binPad])
}
