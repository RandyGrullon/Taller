import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

/** Muestra un GLB que se puede girar con el ratón. */
export function Visor3D({ url }: { url: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const caja = ref.current
    if (!caja) return
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    caja.appendChild(renderer.domElement)

    const escena = new THREE.Scene()
    const camara = new THREE.PerspectiveCamera(40, 1, 0.01, 100)
    escena.add(new THREE.HemisphereLight(0xffffff, 0x8a7f72, 1.6))
    const sol = new THREE.DirectionalLight(0xffffff, 2.2)
    sol.position.set(3, 5, 4)
    escena.add(sol)
    const relleno = new THREE.DirectionalLight(0xffe2cc, 0.8)
    relleno.position.set(-4, 2, -3)
    escena.add(relleno)

    const controles = new OrbitControls(camara, renderer.domElement)
    controles.enableDamping = true
    controles.autoRotate = true
    controles.autoRotateSpeed = 1.2

    const ajustar = () => {
      const { width, height } = caja.getBoundingClientRect()
      renderer.setSize(width, height, false)
      renderer.domElement.style.width = '100%'
      renderer.domElement.style.height = '100%'
      camara.aspect = width / Math.max(height, 1)
      camara.updateProjectionMatrix()
    }
    ajustar()
    const observador = new ResizeObserver(ajustar)
    observador.observe(caja)

    let vivo = true
    new GLTFLoader().load(
      url,
      (gltf) => {
        if (!vivo) return
        const modelo = gltf.scene
        // Las mallas de Hunyuan llegan sin material: se les pone uno de arcilla
        modelo.traverse((o) => {
          const m = o as THREE.Mesh
          if (m.isMesh && (!m.material || (m.material as THREE.MeshStandardMaterial).map == null)) {
            m.material = new THREE.MeshStandardMaterial({ color: 0xd9cfc1, roughness: 0.65, metalness: 0.02 })
          }
        })
        const caja3 = new THREE.Box3().setFromObject(modelo)
        const centro = caja3.getCenter(new THREE.Vector3())
        const tam = caja3.getSize(new THREE.Vector3()).length() || 1
        modelo.position.sub(centro)
        escena.add(modelo)
        camara.position.set(tam * 0.9, tam * 0.55, tam * 1.1)
        camara.near = tam / 100
        camara.far = tam * 20
        camara.updateProjectionMatrix()
        controles.target.set(0, 0, 0)
        controles.update()
      },
      undefined,
      () => vivo && setError('No se pudo abrir el modelo 3D.')
    )

    let cuadro = 0
    const animar = () => {
      cuadro = requestAnimationFrame(animar)
      controles.update()
      renderer.render(escena, camara)
    }
    animar()

    return () => {
      vivo = false
      cancelAnimationFrame(cuadro)
      observador.disconnect()
      controles.dispose()
      renderer.dispose()
      escena.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.isMesh) {
          m.geometry.dispose()
          ;(Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose())
        }
      })
      renderer.domElement.remove()
    }
  }, [url])

  return (
    <div className="visor3d" ref={ref}>
      {error ? <div className="ayuda">{error}</div> : <div className="ayuda">Arrastra para girar · rueda para acercar</div>}
    </div>
  )
}
