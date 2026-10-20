import { useId } from 'react'

/**
 * El martillo forma la «T» de Taller y las chispas son la IA.
 * Con `animado` el martillo golpea y las chispas saltan en cada golpe.
 */
export function Logo({ tam = 28, animado = false, className = '' }: { tam?: number; animado?: boolean; className?: string }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg
      width={tam}
      height={tam}
      viewBox="0 0 512 512"
      className={`logo ${animado ? 'logo-animado' : ''} ${className}`}
      role="img"
      aria-label="Taller"
    >
      <defs>
        <linearGradient id={`f${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#EE9465" />
          <stop offset="0.5" stopColor="#C8572D" />
          <stop offset="1" stopColor="#8A3417" />
        </linearGradient>
        <linearGradient id={`b${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.32" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`m${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFFDF9" />
          <stop offset="1" stopColor="#F6E3D6" />
        </linearGradient>
        <filter id={`s${id}`} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="10" stdDeviation="12" floodColor="#5A1E08" floodOpacity="0.35" />
        </filter>
      </defs>
      <rect x="16" y="16" width="480" height="480" rx="116" fill={`url(#f${id})`} />
      <path d="M132 16h248a116 116 0 0 1 116 116v40C380 212 220 120 16 196v-64A116 116 0 0 1 132 16z" fill={`url(#b${id})`} />
      <g className="logo-martillo" filter={`url(#s${id})`}>
        <rect x="216" y="196" width="60" height="214" rx="30" fill={`url(#m${id})`} />
        <rect x="216" y="338" width="60" height="16" fill="#E7B79C" opacity="0.7" />
        <path d="M152 140h178a16 16 0 0 1 16 16v52a16 16 0 0 1-16 16H152l-40-22v-40z" fill={`url(#m${id})`} />
        <rect x="334" y="122" width="62" height="120" rx="20" fill={`url(#m${id})`} />
      </g>
      <g className="logo-chispas" fill="#FFE2A3">
        <path className="chispa c1" d="M392 300l12 30 30 12-30 12-12 30-12-30-30-12 30-12z" />
        <path className="chispa c2" d="M118 304l8 20 20 8-20 8-8 20-8-20-20-8 20-8z" />
        <path className="chispa c3" d="M420 410l6 14 14 6-14 6-6 14-6-14-14-6 14-6z" />
      </g>
    </svg>
  )
}
