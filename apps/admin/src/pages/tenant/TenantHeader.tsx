import { Link } from 'react-router-dom'
import { Badge, PageHeader } from '../../components/ui'
import { formatDateId } from './types'

type Props = {
  tenantId: string
  name: string
  slug: string | null
  joinedAt: string | null
  subStatus: string
  planName: string
}

// Header ringkas: breadcrumb + nama + metadata + badge + kembali.
export function TenantHeader({ tenantId, name, slug, joinedAt, subStatus, planName }: Props) {
  return (
    <div className="space-y-3">
      <nav aria-label="Breadcrumb">
        <ol className="flex flex-wrap items-center gap-1.5 text-[13px] text-slate-500">
          <li>Platform Admin</li>
          <li aria-hidden className="text-slate-300">/</li>
          <li>
            <Link to="/platform/tenants" className="font-medium hover:text-slate-800 hover:underline">
              Tenant
            </Link>
          </li>
          <li aria-hidden className="text-slate-300">/</li>
          <li aria-current="page" className="font-semibold text-slate-800">
            {name}
          </li>
        </ol>
      </nav>
      <PageHeader
        title={name}
        desc={`ID ${tenantId}${slug ? ` · ${slug}` : ''} · bergabung ${formatDateId(joinedAt)}`}
        actions={
          <>
            <Badge status={subStatus} />
            <Badge status={planName} tone="blue" />
            <Link
              to="/platform/tenants"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-white px-4 text-[13px] font-semibold text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50"
            >
              <span className="material-symbols-outlined text-lg" aria-hidden>arrow_back</span>
              Kembali
            </Link>
          </>
        }
      />
    </div>
  )
}
