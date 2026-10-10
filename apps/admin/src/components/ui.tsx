import type { ReactNode } from 'react'

// Primitives tunggal UI Platform Admin — semua halaman WAJIB memakai ini
// agar radius, spacing, dan pola visual konsisten.

// ---------- Button ----------
type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success'

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md' }) {
  const base =
    'inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60'
  const sizes = { sm: 'h-9 px-4 text-[13px]', md: 'h-11 px-6 text-sm' }
  const variants: Record<ButtonVariant, string> = {
    primary: 'bg-slate-900 text-white shadow-sm hover:bg-slate-700',
    secondary: 'bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50',
    danger: 'bg-red-700 text-white shadow-sm hover:bg-red-600',
    success: 'bg-emerald-700 text-white shadow-sm hover:bg-emerald-600',
    ghost: 'text-slate-600 hover:bg-slate-100',
  }
  return <button className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} {...props} />
}

// ---------- Card ----------
export function Card({ className = '', children }: { className?: string; children: ReactNode }) {
  return <div className={`rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200 ${className}`}>{children}</div>
}

export function CardTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-[15px] font-semibold text-slate-900">{children}</h2>
      {action}
    </div>
  )
}

// ---------- PageHeader ----------
export function PageHeader({ title, desc, actions }: { title: string; desc?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">{title}</h1>
        {desc && <p className="mt-1 text-sm text-slate-500">{desc}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

// ---------- Field / Input / Select / Textarea ----------
const inputBase =
  'h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10'

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <span className="mt-1 block font-normal">{children}</span>
      {hint && <span className="mt-1 block text-xs font-normal text-slate-400">{hint}</span>}
    </label>
  )
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputBase} ${props.className ?? ''}`} />
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputBase} ${props.className ?? ''}`} />
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`min-h-24 w-full rounded-lg border border-slate-300 bg-white p-3 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 ${props.className ?? ''}`}
    />
  )
}

// ---------- Badge (warna semantik status) ----------
type BadgeTone = 'green' | 'amber' | 'red' | 'gray' | 'blue'

const STATUS_TONE: Record<string, BadgeTone> = {
  active: 'green',
  paid: 'green',
  onboarded: 'green',
  contacted: 'blue',
  new: 'gray',
  past_due: 'amber',
  unpaid: 'amber',
  suspended: 'red',
  overdue: 'red',
  canceled: 'red',
  rejected: 'red',
  void: 'gray',
}

const TONE_CLS: Record<BadgeTone, string> = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  amber: 'bg-amber-50 text-amber-700 ring-amber-600/25',
  red: 'bg-red-50 text-red-700 ring-red-600/20',
  gray: 'bg-slate-100 text-slate-600 ring-slate-500/10',
  blue: 'bg-sky-50 text-sky-700 ring-sky-600/20',
}

export function Badge({ status, tone }: { status: string; tone?: BadgeTone }) {
  const t = tone ?? STATUS_TONE[status] ?? 'gray'
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${TONE_CLS[t]}`}>
      {status}
    </span>
  )
}

// ---------- Table ----------
export function Table({
  head,
  children,
  empty,
}: {
  head: string[]
  children: ReactNode
  empty?: string
}) {
  return (
    <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
      <table className="w-full min-w-160 text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            {head.map((h) => (
              <th key={h} className="whitespace-nowrap px-4 py-3 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
      {empty && (
        <p className="border-t border-slate-100 px-4 py-8 text-center text-sm text-slate-400">{empty}</p>
      )}
    </div>
  )
}

export function Td({ className = '', colSpan, children }: { className?: string; colSpan?: number; children: ReactNode }) {
  return <td colSpan={colSpan} className={`px-4 py-3 align-top ${className}`}>{children}</td>
}

// ---------- Alert / Empty / Skeleton ----------
export function Alert({ tone, children }: { tone: 'error' | 'success' | 'info'; children: ReactNode }) {
  const cls =
    tone === 'error'
      ? 'bg-red-50 text-red-700 ring-red-600/20'
      : tone === 'success'
        ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/20'
        : 'bg-sky-50 text-sky-700 ring-sky-600/20'
  return <p className={`rounded-lg px-3 py-2.5 text-sm font-medium ring-1 ring-inset ${cls}`}>{children}</p>
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="animate-pulse space-y-2 rounded-xl bg-white p-5 ring-1 ring-slate-200" aria-hidden>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-4 rounded bg-slate-100" style={{ width: `${100 - i * 12}%` }} />
      ))}
    </div>
  )
}

// ---------- Modal ----------
export function Modal({
  title,
  desc,
  onClose,
  children,
  wide,
}: {
  title: string
  desc?: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`max-h-[90vh] w-full overflow-y-auto rounded-2xl bg-white p-6 shadow-xl ${wide ? 'max-w-2xl' : 'max-w-lg'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">{title}</h2>
            {desc && <p className="mt-0.5 text-sm text-slate-500">{desc}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Tutup"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  )
}
