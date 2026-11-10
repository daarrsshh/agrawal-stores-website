// Stock status shown under each product (set by staff on the admin page).
//   stock: 'in' | 'few' | 'out'   (missing = not set, nothing shown)
//   sizes: [{ size: '24', stock: 'in' | 'few' | 'out' }]   (optional)
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const STOCK = {
  in: { label: 'Available', cls: 'text-green-700', dot: 'bg-green-600' },
  few: { label: 'Few left', cls: 'text-amber-700', dot: 'bg-amber-500' },
  out: { label: 'Out of stock right now', cls: 'text-slate-500', dot: 'bg-slate-400' },
};

// If every size is out, the item is out; if any size has stock, the item is at least available.
export function overall(p) {
  const sizes = (p.sizes || []).filter((s) => s && s.size);
  if (!sizes.length) return STOCK[p.stock] ? p.stock : null;
  if (sizes.every((s) => s.stock === 'out')) return 'out';
  if (sizes.some((s) => s.stock === 'in')) return p.stock === 'few' ? 'few' : 'in';
  return 'few';
}

export function stockLine(p) {
  const st = overall(p);
  if (!st) return '';
  const k = STOCK[st];
  const sizes = (p.sizes || []).filter((s) => s && s.size && s.stock !== 'out');
  const sizeText = st !== 'out' && sizes.length
    ? ` · Sizes ${sizes.map((s) => esc(s.size) + (s.stock === 'few' ? ' (few)' : '')).join(', ')}`
    : '';
  const tail = st === 'out' ? ' · call to order' : '';
  return `<p data-stock="${st}" class="flex items-start gap-1.5 px-3 pb-2 -mt-1 text-sm font-bold ${k.cls}"><span aria-hidden="true" class="mt-1.5 h-2 w-2 shrink-0 rounded-full ${k.dot}"></span><span>${k.label}${sizeText}${tail}</span></p>`;
}
