export function OrderSkeleton({ label, menu = false }: { label: string; menu?: boolean }) {
  return (
    <div role="status" className="mx-auto w-full max-w-md px-4 py-6 text-soil">
      <p className="mb-5 text-sm font-semibold">{label}</p>
      <div aria-hidden="true" className="self-order-skeleton space-y-4">
        <div className="h-12 rounded-xl bg-clay/40" />
        <div className={menu ? 'grid grid-cols-2 gap-3' : 'space-y-3'}>
          {[0, 1, 2, 3].map((slot) => <div key={slot} className={menu ? 'h-36 rounded-xl bg-clay/30' : 'h-10 rounded-lg bg-clay/30'} />)}
        </div>
      </div>
    </div>
  )
}
