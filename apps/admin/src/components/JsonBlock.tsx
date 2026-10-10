import { useState } from 'react'

// Blok JSON teknis: monospace, tinggi dibatasi + scroll internal, tombol salin.
export function JsonBlock({ data, label }: { data: unknown; label: string }) {
  const [copied, setCopied] = useState(false)
  const text = JSON.stringify(data, null, 2)
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }
  return (
    <div className="overflow-hidden rounded-lg ring-1 ring-slate-200">
      <div className="flex items-center justify-between gap-2 bg-slate-50 px-3 py-1.5">
        <span className="text-xs font-semibold text-slate-500">{label}</span>
        <button
          type="button"
          onClick={() => void copy()}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-200/70"
        >
          <span className="material-symbols-outlined text-base" aria-hidden>
            {copied ? 'check' : 'content_copy'}
          </span>
          {copied ? 'Disalin' : 'Salin'}
        </button>
      </div>
      <pre className="max-h-72 overflow-auto bg-white p-3 font-mono text-xs leading-relaxed text-slate-600">
        {text}
      </pre>
    </div>
  )
}
