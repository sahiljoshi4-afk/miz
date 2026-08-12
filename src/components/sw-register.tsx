'use client'

import { useEffect } from 'react'

export function SwRegister() {
  useEffect(() => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  }, [])
  return null
}
