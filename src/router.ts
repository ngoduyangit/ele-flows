import { useEffect, useState } from 'react'

/** Minimal hash router: "#/" (home) and "#/flows/:id" (editor). */
export function navigate(path: string) {
  location.hash = path
}

export function useRoute(): string {
  const [hash, setHash] = useState(() => location.hash.slice(1))
  useEffect(() => {
    const on = () => setHash(location.hash.slice(1))
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return hash
}
