import { memo, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '../util'

function BloqueCodigo({ lenguaje, children }: { lenguaje?: string; children: ReactNode }) {
  const [copiado, setCopiado] = useState(false)
  const texto = String(children ?? '').replace(/\n$/, '')
  return (
    <div className="bloque-codigo">
      <div className="barra">
        <span>{lenguaje || 'texto'}</span>
        <button
          onClick={() => {
            void navigator.clipboard.writeText(texto)
            setCopiado(true)
            setTimeout(() => setCopiado(false), 1500)
          }}
        >
          {copiado ? 'Copiado' : 'Copiar'}
        </button>
      </div>
      <pre>
        <code>{texto}</code>
      </pre>
    </div>
  )
}

export const Markdown = memo(function Markdown({ texto }: { texto: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => <>{children}</>,
          code({ className, children }) {
            const lenguaje = /language-(\S+)/.exec(className ?? '')?.[1]
            const enBloque = !!lenguaje || String(children).includes('\n')
            return enBloque ? <BloqueCodigo lenguaje={lenguaje}>{children}</BloqueCodigo> : <code>{children}</code>
          },
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(e) => {
                e.preventDefault()
                if (href) void api.abrirExterno(href)
              }}
            >
              {children}
            </a>
          )
        }}
      >
        {texto}
      </ReactMarkdown>
    </div>
  )
})
