/// <reference types="vite/client" />
import type { ApiTaller } from '@shared/api'

declare global {
  interface Window {
    taller: ApiTaller
  }
}

export {}
