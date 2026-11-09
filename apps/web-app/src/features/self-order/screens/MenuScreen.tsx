import { IMG } from "../../../mock/data";
import { useCafe } from "../../../mock/store";
import type { CartItem, Product } from "../../../shared/types";
import { normalizeTheme } from "../../../shared/types";
import { formatRupiah } from "../../../shared/lib/format";
import {
  IconCart,
  IconPlus,
  IconSearch,
} from "../../../shared/components/icons";
import { useEffect, useRef, useState } from "react";

interface Props {
  tableNumber: string;
  products: Product[];
  cart: CartItem[];
  addedItem: { sequence: number; name: string; quantity: number } | null;
  visible: boolean;
  onSelectItem: (item: Product) => void;
  onGoCart: () => void;
}

export function MenuScreen({
  tableNumber,
  products,
  cart,
  addedItem,
  visible,
  onSelectItem,
  onGoCart,
}: Props) {
  const { business, categories } = useCafe();
  const theme = normalizeTheme(business.theme);
  const headerBg = theme.headerImage || IMG.headerBg;
  const titleFont = theme.titleFont === 'sans' ? 'font-sans' : theme.titleFont === 'serif' ? 'font-serif' : 'font-display';
  const pillRadius = theme.radius === 'full' ? 'rounded-full' : 'rounded-[12px]';
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const categoryListRef = useRef<HTMLDivElement>(null);
  const categoryScrollFrame = useRef(0);
  const cartTotal = cart.reduce((s, i) => s + i.price * i.quantity, 0);
  const cartCount = cart.reduce((s, i) => s + i.quantity, 0);

  const query = search.trim().toLowerCase();
  const filtered = products.filter((item) => `${item.name} ${item.description ?? ''}`.toLowerCase().includes(query));
  const categoryIds = new Set(categories.map(({ id }) => id));
  const sections = [
    ...categories.map(({ id, name }) => ({ id: `category-${id}`, name, items: filtered.filter((item) => item.categoryId === id) })),
    { id: 'other', name: 'Menu lainnya', items: filtered.filter((item) => !categoryIds.has(item.categoryId)) },
  ].filter(({ items }) => items.length > 0);
  const activeCategory = sections.some(({ id }) => id === category) ? category : sections[0]?.id;

  useEffect(() => {
    const scroller = scrollRef.current;
    const bar = barRef.current;
    if (!visible || !scroller || !bar) return;
    let frame = 0;
    const update = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const headings = Array.from(scroller.querySelectorAll<HTMLElement>('[data-menu-section]'));
        const edge = scroller.getBoundingClientRect().top + bar.offsetHeight + 12;
        const atEnd = scroller.scrollTop > 0 && scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop < 2;
        let current = headings[0];
        for (const heading of headings) {
          if (heading.getBoundingClientRect().top <= edge || atEnd) current = heading;
          else break;
        }
        setCategory(current?.dataset.menuSection ?? null);
      });
    };
    const resize = new ResizeObserver(update);
    resize.observe(scroller);
    resize.observe(bar);
    scroller.addEventListener('scroll', update, { passive: true });
    update();
    return () => {
      scroller.removeEventListener('scroll', update);
      resize.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [visible, query, products, categories]);

  useEffect(() => {
    const list = categoryListRef.current;
    const button = list?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!visible || !list || !button) return;
    const listRect = list.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    if (buttonRect.left < listRect.left || buttonRect.right > listRect.right) {
      list.scrollLeft += buttonRect.left - listRect.left - (listRect.width - buttonRect.width) / 2;
    }
  }, [activeCategory, visible]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!visible || !scroller) return;
    const stopScroll = () => cancelAnimationFrame(categoryScrollFrame.current);
    scroller.addEventListener('wheel', stopScroll, { passive: true });
    scroller.addEventListener('touchstart', stopScroll, { passive: true });
    scroller.addEventListener('pointerdown', stopScroll, { passive: true });
    scroller.addEventListener('keydown', stopScroll);
    return () => {
      stopScroll();
      scroller.removeEventListener('wheel', stopScroll);
      scroller.removeEventListener('touchstart', stopScroll);
      scroller.removeEventListener('pointerdown', stopScroll);
      scroller.removeEventListener('keydown', stopScroll);
    };
  }, [visible, query]);

  function scrollToCategory(id: string) {
    const scroller = scrollRef.current;
    const target = Array.from(scroller?.querySelectorAll<HTMLElement>('[data-menu-section]') ?? [])
      .find((section) => section.dataset.menuSection === id);
    if (!scroller || !target) return;
    cancelAnimationFrame(categoryScrollFrame.current);
    const start = scroller.scrollTop;
    const offset = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - (barRef.current?.offsetHeight ?? 0) - 8;
    const end = Math.max(0, Math.min(start + offset, scroller.scrollHeight - scroller.clientHeight));
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || Math.abs(end - start) < 1) {
      scroller.scrollTop = end;
      return;
    }
    const startedAt = performance.now();
    function animate(now: number) {
      const progress = Math.min((now - startedAt) / 360, 1);
      scroller!.scrollTop = start + (end - start) * (1 - (1 - progress) ** 3);
      if (progress < 1) categoryScrollFrame.current = requestAnimationFrame(animate);
    }
    categoryScrollFrame.current = requestAnimationFrame(animate);
  }

  function qtyFor(id: string) {
    return cart
      .filter((c) => c.productId === id)
      .reduce((s, c) => s + c.quantity, 0);
  }

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ background: theme.pageBg }}>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-hide">
      <div className="relative shrink-0">
        <img
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          src={headerBg}
        />
        <div className="absolute inset-0 bg-black" style={{ opacity: theme.headerOverlay / 100 }} />
        <div className="relative flex flex-col items-center gap-3 px-5 py-6">
          {business.logoUrl ? (
            <img
              src={business.logoUrl}
              alt={business.name}
              className="size-16 rounded-full border border-white/30 object-cover"
              style={{ background: theme.primary }}
            />
          ) : (
            <div
              className="flex size-16 items-center justify-center rounded-full font-display text-xl text-white"
              style={{ background: theme.primary }}
            >
              {(business.name || 'B').charAt(0).toUpperCase()}
            </div>
          )}
          <div className="text-center">
            <p className={`text-2xl font-bold text-white ${titleFont}`}>
              {business.name}
            </p>
            <p className="text-sm font-medium text-white">
              {theme.welcomeText}
            </p>
            {theme.showTagline && <p className="text-xs italic text-white/80">{business.tagline}</p>}
          </div>
          <div className={`border border-white/30 px-4 py-1 text-xs font-semibold text-white ${pillRadius}`} style={{ background: `${theme.accent}88` }}>
            Table {tableNumber}
          </div>
        </div>
      </div>

        <div className="relative mx-4 my-4">
            <div className="absolute left-4 top-1/2 -translate-y-1/2">
              <IconSearch />
            </div>
            <input
              className="h-14 w-full rounded-full bg-[#eee] pl-12 pr-4 text-base text-soil shadow-inner outline-none"
              placeholder="Cari minuman atau makanan..."
              aria-label="Cari menu"
              value={search}
              onChange={(e) => { setSearch(e.target.value); scrollRef.current?.scrollTo({ top: 0 }) }}
            />
          </div>
          <div ref={barRef} hidden={sections.length === 0} className="sticky top-0 z-10 border-b border-clay/20 py-2" style={{ background: theme.pageBg }}>
          <div ref={categoryListRef} role="navigation" aria-label="Kategori menu" className="flex gap-2 overflow-x-auto px-4 scrollbar-hide">
            {sections.map(({ id, name }) => (
              <button type="button" key={id} onClick={() => scrollToCategory(id)} aria-current={activeCategory === id ? 'true' : undefined}
                style={activeCategory === id ? { background: theme.primary, color: '#fff' } : undefined}
                className={`min-h-11 shrink-0 px-4 text-sm font-semibold ${pillRadius} ${
                  activeCategory === id
                    ? ""
                    : "border border-clay/30 bg-[#eee] text-soil"
                }`}>{name}
              </button>
            ))}
          </div>
          </div>
          <div className="space-y-6 px-4 pb-5 pt-3">
          {sections.length === 0 && <p role="status" className="py-8 text-center text-sm text-soil">{query ? 'Tidak ada menu yang cocok. Coba kata lain.' : 'Menu belum tersedia.'}</p>}
          {sections.map(({ id, name, items }) => (
          <section key={id} data-menu-section={id} aria-labelledby={`heading-${id}`}>
          <h2 id={`heading-${id}`} className={`mb-3 text-lg font-bold ${titleFont}`}>{name}</h2>
          <div className="grid grid-cols-1 gap-3 min-[340px]:grid-cols-2 sm:gap-4">
            {items.map((item) => {
              const qty = qtyFor(item.id);
              return (
                <div
                  key={item.id}
                  style={qty > 0 ? { boxShadow: `0 0 0 2px ${theme.accent}` } : undefined}
                  className={`flex flex-col overflow-hidden rounded-[12px] bg-white shadow-[0_4px_15px_rgba(74,124,89,0.06)] ${
                    !item.isAvailable ? "opacity-60" : ""
                  }`}
                >
                  <div className="relative flex h-[150px] items-center justify-center bg-[#e2e2e2]">
                    {item.imageUrl ? (
                      <img
                        alt={item.name}
                        loading="lazy"
                        decoding="async"
                        src={item.imageUrl}
                        className={`absolute inset-0 h-full w-full object-cover ${
                          !item.isAvailable ? "saturate-0" : ""
                        }`}
                      />
                    ) : (
                      <span className="font-display text-4xl text-stone">
                        {(item.name || '?').charAt(0).toUpperCase()}
                      </span>
                    )}
                    {item.badge && (
                      <span
                        className="absolute right-2 top-2 rounded-[6px] px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-white"
                        style={{ background: theme.accent }}
                      >
                        {item.badge}
                      </span>
                    )}
                    {!item.isAvailable && (
                      <div className="absolute inset-0 flex items-center justify-center bg-paper/40">
                        <span className="rounded-[6px] bg-[#ba1a1a]/90 px-2 py-1 text-xs text-white">
                          Habis
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col justify-between p-3">
                    <div>
                      <p className="text-sm font-semibold leading-snug text-ink">
                        {item.name}
                      </p>
                      <p className="mb-2 line-clamp-2 text-xs text-soil">
                        {item.description}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <span className="text-sm font-semibold">
                        {formatRupiah(item.price)}
                      </span>
                      {item.isAvailable && (
                        <button
                          type="button"
                          className="flex size-11 shrink-0 items-center justify-center rounded-full transition-transform active:scale-95"
                          style={{ background: theme.primary }}
                          onClick={() =>  onSelectItem(item)}
                          aria-label={`Tambah ${item.name} ke keranjang`}
                        >
                          <IconPlus />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          </section>
          ))}
        </div>
      </div>

      {cartCount > 0 && (
        <div className="relative z-10 shrink-0 px-4 pb-2 pt-1">
          {addedItem && <span key={addedItem.sequence} aria-hidden="true" className="self-order-add-badge pointer-events-none absolute bottom-full right-5 rounded-lg bg-ink px-3 py-1.5 text-sm font-bold text-white">+{addedItem.quantity} item</span>}
          <button
            type="button"
            onClick={onGoCart}
            style={{ background: theme.primary }}
            className="flex min-h-14 w-full items-center justify-between gap-2 rounded-[12px] px-3 py-2 text-white shadow-lg transition-transform active:scale-[0.98]"
          >
            <div className="flex items-center gap-3">
              <div className="relative flex size-10 items-center justify-center rounded-full bg-white/20">
                <IconCart />
                <span
                  className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full text-[10px] font-bold text-white"
                  style={{ background: theme.accent }}
                >
                  {cartCount}
                </span>
              </div>
              <div className="text-left">
                <p className="text-xs text-white/80">{cartCount} Item</p>
                <p className="font-display text-xl font-semibold">
                  {formatRupiah(cartTotal)}
                </p>
              </div>
            </div>
            <span className="shrink-0 rounded-lg bg-white px-3 py-2 text-sm font-bold text-ink">Checkout</span>
          </button>
        </div>
      )}
      <p role="status" aria-atomic="true" className="sr-only">{addedItem ? `${addedItem.quantity} ${addedItem.name} ditambahkan. ${cartCount} item di keranjang.` : ''}</p>
    </div>
  );
}
