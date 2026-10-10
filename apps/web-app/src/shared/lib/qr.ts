// URL absolut Self-Order untuk di-encode ke QR meja.
// Dipindai HP pelanggan -> langsung buka SelfOrderApp (/order/:qrToken) tanpa login.
// Base diambil dari VITE_PUBLIC_BASE_URL (prod, mis. https://app.oxcribe.id)
// fallback ke origin saat ini (dev http://localhost:5173).
// Path app mengikuti vite.config base via import.meta.env.BASE_URL.
export function getSelfOrderUrl(qrToken: string): string {
  const publicBase = (import.meta.env.VITE_PUBLIC_BASE_URL as string | undefined)?.trim().replace(/\/$/, '')
  const origin = publicBase || window.location.origin
  const appBase = (import.meta.env.BASE_URL as string | undefined) || '/'
  const normalizedBase = appBase === '/' ? '' : appBase.replace(/\/$/, '')
  return `${origin}${normalizedBase}/order/${qrToken}`
}
