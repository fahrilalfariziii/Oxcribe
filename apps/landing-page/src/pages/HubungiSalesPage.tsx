import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Headbar } from '../components/Headbar'
import { Footer } from '../components/Footer'
import { SALES_WHATSAPP, salesWaLink, submitSalesInquiry } from '../lib/api'

const JOB_ROLES = ['Owner / Founder', 'General Manager', 'Head of Operation', 'Head Barista / Roaster', 'IT & Hardware Procurement', 'Lainnya']
const OUTLET_SCALES = ['1 Outlet (Single Bar)', '2 - 5 Outlet (Growing Chain)', '6 - 15 Outlet (Multi-Store Brand)', 'Lebih dari 15 Cabang (Enterprise)']
const NEED_CATEGORIES = ['Paket Basic', 'Paket Pro', 'Paket Enterprise', 'Demo Personal', 'Jasa Website']

const WA_TEXT_POS =
  'Halo Tim Sales Oxcribe, saya tertarik konsultasi sistem POS dan self-ordering untuk kafe kami.'
const WA_TEXT_JASA =
  'Halo Tim Sales Oxcribe, saya tertarik konsultasi Jasa Website Oxcribe untuk bisnis kami.'

type FormStatus = 'idle' | 'sending' | 'done' | 'error'

const inputCls =
  'h-12 w-full rounded-lg bg-surface px-4 text-base text-on-surface shadow-inner outline-none transition-all placeholder:text-on-surface-variant/50 focus:ring-2 focus:ring-secondary/40'

export function HubungiSalesPage() {
  const [params] = useSearchParams()
  const [fullName, setFullName] = useState('')
  const [jobRole, setJobRole] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [brandName, setBrandName] = useState('')
  const [outletCount, setOutletCount] = useState('')
  const [needCategory, setNeedCategory] = useState(
    params.get('layanan') === 'jasa-website' ? 'Jasa Website' : 'Paket Pro',
  )
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState<FormStatus>('idle')
  const [msg, setMsg] = useState('')

  const isJasa = needCategory === 'Jasa Website'
  const waText = isJasa ? WA_TEXT_JASA : WA_TEXT_POS

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('sending')
    setMsg('')
    try {
      await submitSalesInquiry({ fullName, jobRole, email, phone, brandName, outletCount, needCategory, message })
      setStatus('done')
      setMsg(
        'Pesan berhasil terkirim ke tim sales! Konfirmasi telah tercatat — tim kami akan menghubungi Anda via WhatsApp & Email.',
      )
    } catch (err) {
      setStatus('error')
      setMsg(err instanceof Error ? err.message : 'Gagal mengirim. Coba lagi.')
    }
  }

  return (
    <div className="min-h-screen bg-surface">
      <Headbar />
      <main>
        <section className="relative w-full overflow-hidden py-10">
          <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-secondary-fixed/30 blur-3xl" />
          <div className="pointer-events-none absolute -left-20 top-1/2 h-80 w-80 rounded-full bg-primary-fixed/20 blur-3xl" />
          <div className="relative z-10 mx-auto max-w-[90rem] px-4 sm:px-6 lg:px-8">
            <div className="mb-10 max-w-3xl">
              <h1 className="font-display text-balance text-[clamp(1.9rem,6.5vw,3.75rem)] font-bold leading-[1.12] tracking-tight text-primary">
                {isJasa
                  ? 'Konsultasi Jasa Website untuk Bisnis Anda Bersama Tim Sales Oxcribe'
                  : 'Konsultasi Kebutuhan Kafe Anda Bersama Tim Sales Oxcribe'}
              </h1>
              <p className="mt-4 text-base leading-relaxed text-on-surface-variant sm:text-lg lg:text-xl">
                {isJasa
                  ? 'Ceritakan kebutuhan website bisnis Anda — company profile, landing page, e-commerce, atau web app custom. Konsultasi gratis, penawaran transparan.'
                  : 'Diskusikan implementasi sistem POS, rencana multi-outlet, kustomisasi paket Enterprise, integrasi hardware kasir, atau demo sistem langsung bersama tim kami.'}
              </p>
            </div>

            <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
              {/* WA CARD */}
              <div className="flex flex-col gap-6 lg:col-span-5 lg:sticky lg:top-24">
                <div className="relative overflow-hidden rounded-xl bg-surface-container-lowest p-5 shadow-md transition-all hover:shadow-xl sm:p-6">
                  <div className="pointer-events-none absolute right-0 top-0 h-32 w-32 rounded-bl-full bg-secondary/10" />
                  <div className="mb-4 flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 rounded bg-secondary-fixed px-2.5 py-1 text-[11px] font-bold text-on-secondary-fixed">
                      <span className="material-symbols-outlined text-[14px]">bolt</span>
                      RESPON LANGSUNG &amp; REAL-TIME
                    </span>
                  </div>
                  <h2 className="font-display mb-4 text-2xl font-semibold text-on-surface">
                    Butuh Respon Cepat? Hubungi via WhatsApp
                  </h2>
                  <a
                    href={salesWaLink(waText)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex w-full items-center justify-between rounded-lg bg-primary px-6 py-4 text-[15px] font-semibold text-on-primary shadow-md transition-all hover:bg-primary-container active:scale-[0.98]"
                  >
                    <span className="flex items-center gap-3">
                      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[#25D366] text-white shadow-sm">
                        <svg className="h-5 w-5 fill-current" viewBox="0 0 24 24" aria-hidden>
                          <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z" />
                        </svg>
                      </span>
                      <span className="text-left text-[13px] font-semibold tracking-wide">
                        Chat WhatsApp Sales
                      </span>
                    </span>
                    <span className="material-symbols-outlined text-[20px] transition-transform group-hover:translate-x-1">
                      arrow_forward
                    </span>
                  </a>
                  <div className="mt-4 flex items-center gap-2 pt-1 text-sm text-on-surface-variant">
                    <span className="material-symbols-outlined text-[18px] text-secondary">schedule</span>
                    <span>Online Senin – Minggu (08.00 – 21.00 WIB) • Rata-rata respon 3 menit</span>
                  </div>
                  <p className="mt-2 font-mono text-xs text-on-surface-variant/60">{SALES_WHATSAPP}</p>
                </div>
              </div>

              {/* EMAIL FORM */}
              <div className="lg:col-span-7">
                <div className="rounded-xl bg-surface-container-lowest p-5 shadow-md sm:p-10">
                  <div className="mb-6 flex flex-col justify-between gap-3 border-b border-surface-container-high pb-6 sm:flex-row sm:items-center">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-primary-fixed text-primary">
                        <span className="material-symbols-outlined text-[24px]">forward_to_inbox</span>
                      </div>
                      <div>
                        <h3 className="font-display text-xl font-semibold text-on-surface">Kirim Pesan via Email</h3>
                        <p className="text-sm text-on-surface-variant">
                          Tim solusi kami akan merespons dalam waktu &lt; 2 jam kerja
                        </p>
                      </div>
                    </div>
                    <span className="inline-flex w-fit items-center gap-1 rounded bg-secondary-fixed/50 px-2.5 py-1 text-[13px] font-semibold text-secondary">
                      <span className="material-symbols-outlined text-[14px]">bolt</span> SLA Terjamin
                    </span>
                  </div>

                  <form onSubmit={onSubmit} className="space-y-4">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label htmlFor="full_name" className="mb-1 block text-sm font-semibold text-on-surface">
                          Nama Lengkap <span className="text-error">*</span>
                        </label>
                        <input
                          id="full_name"
                          required
                          value={fullName}
                          onChange={(e) => setFullName(e.target.value)}
                          placeholder="Contoh: Dimas Aditya"
                          className={inputCls}
                        />
                      </div>
                      <div>
                        <label htmlFor="job_role" className="mb-1 block text-sm font-semibold text-on-surface">
                          Jabatan / Peran <span className="text-error">*</span>
                        </label>
                        <select
                          id="job_role"
                          required
                          value={jobRole}
                          onChange={(e) => setJobRole(e.target.value)}
                          className={inputCls}
                        >
                          <option value="" disabled>
                            Pilih peran Anda
                          </option>
                          {JOB_ROLES.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label htmlFor="work_email" className="mb-1 block text-sm font-semibold text-on-surface">
                          Email Bisnis <span className="text-error">*</span>
                        </label>
                        <input
                          id="work_email"
                          required
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="dimas@kopisenja.id"
                          className={inputCls}
                        />
                      </div>
                      <div>
                        <label htmlFor="phone_number" className="mb-1 block text-sm font-semibold text-on-surface">
                          Nomor WhatsApp Aktif <span className="text-error">*</span>
                        </label>
                        <input
                          id="phone_number"
                          required
                          type="tel"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          placeholder="0812-XXXX-XXXX"
                          className={inputCls}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label htmlFor="brand_name" className="mb-1 block text-sm font-semibold text-on-surface">
                          {isJasa ? 'Nama Bisnis / Organisasi' : 'Nama Kafe / Roastery'} <span className="text-error">*</span>
                        </label>
                        <input
                          id="brand_name"
                          required
                          value={brandName}
                          onChange={(e) => setBrandName(e.target.value)}
                          placeholder={isJasa ? 'Contoh: PT Maju Bersama' : 'Contoh: Senja Specialty Coffee'}
                          className={inputCls}
                        />
                      </div>
                      <div>
                        <label htmlFor="outlet_count" className="mb-1 block text-sm font-semibold text-on-surface">
                          Jumlah Outlet / Cabang {!isJasa && <span className="text-error">*</span>}
                        </label>
                        <select
                          id="outlet_count"
                          required={!isJasa}
                          value={outletCount}
                          onChange={(e) => setOutletCount(e.target.value)}
                          className={inputCls}
                        >
                          <option value="" disabled>
                            {isJasa ? 'Opsional untuk jasa website' : 'Pilih skala outlet'}
                          </option>
                          {OUTLET_SCALES.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div>
                      <span className="mb-1 block text-sm font-semibold text-on-surface">
                        Kategori Kebutuhan Utama <span className="text-error">*</span>
                      </span>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {NEED_CATEGORIES.map((c) => (
                          <label
                            key={c}
                            className="relative flex min-h-12 cursor-pointer items-center justify-center rounded-lg bg-surface p-2.5 text-center text-on-surface shadow-sm transition-colors hover:bg-surface-container has-[:checked]:bg-primary has-[:checked]:text-on-primary"
                          >
                            <input
                              type="radio"
                              name="need_category"
                              value={c}
                              checked={needCategory === c}
                              onChange={() => setNeedCategory(c)}
                              className="sr-only"
                            />
                            <span className="text-xs font-bold">{c}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label htmlFor="inquiry_message" className="mb-1 block text-sm font-semibold text-on-surface">
                        Keterangan Kebutuhan / Pertanyaan Khusus <span className="text-error">*</span>
                      </label>
                      <textarea
                        id="inquiry_message"
                        required
                        rows={4}
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder={
                          isJasa
                            ? 'Ceritakan kebutuhan website Anda: jenis website, jumlah halaman, fitur khusus, dan target waktu pengerjaan...'
                            : 'Gambaran operasional kafe Anda, kebutuhan integrasi, jadwal live demo yang diinginkan, atau rencana ekspansi...'
                        }
                        className="w-full rounded-lg bg-surface p-4 text-[15px] text-on-surface shadow-inner outline-none transition-all placeholder:text-on-surface-variant/50 focus:ring-2 focus:ring-secondary/40"
                      />
                    </div>

                    <div className="pt-1">
                      <button
                        type="submit"
                        disabled={status === 'sending'}
                        className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary text-[15px] font-semibold text-on-primary shadow-md transition-all hover:bg-primary-container active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-75"
                      >
                        {status === 'sending' ? (
                          <span>Mengirimkan Pesan...</span>
                        ) : (
                          <>
                            <span className="material-symbols-outlined text-[20px]">send</span>
                            <span>{status === 'done' ? 'Kirim Ulang Pesan' : 'Kirim Pesan ke Tim Sales'}</span>
                          </>
                        )}
                      </button>
                    </div>

                    {msg && (
                      <div
                        className={`rounded-lg p-4 transition-all ${
                          status === 'error' ? 'bg-error-container/40' : 'bg-surface-container-high'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <span className="material-symbols-outlined text-[22px] text-secondary">
                            {status === 'error' ? 'error' : 'check_circle'}
                          </span>
                          <p className="text-left text-sm text-on-surface">{msg}</p>
                        </div>
                      </div>
                    )}
                  </form>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer pos="/pos-kafe" />
    </div>
  )
}
