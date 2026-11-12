// Builds a photo page for each shop section (Gifts & Toys, Stationery, ...) from data/sections.json.
// Every section gets a page with what we stock; photos appear on it as staff add them.
// Run through: node scripts/build-schools.mjs  (it calls this file)
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zoomDialog } from './zoom.mjs';
import { stockLine } from './stock.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE_URL = 'https://agrawalstores.in';
const schools = JSON.parse(readFileSync(path.join(root, 'data/schools.json'), 'utf8'));
const { sections } = JSON.parse(readFileSync(path.join(root, 'data/sections.json'), 'utf8'));
for (const s of sections) s.photos = s.photos.filter((p) => !p.hidden);
const shown = sections.filter((s) => !s.hidden);
let home = readFileSync(path.join(root, 'index.html'), 'utf8');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const wa = (text) => `https://wa.me/${schools.phone.replace('+', '')}?text=${encodeURIComponent(text)}`;

const footer = home.slice(home.indexOf('<!-- Location & Footer -->'), home.indexOf('</footer>') + '</footer>'.length)
  .replace(/pb-44 md:pb-8/, 'pb-36 md:pb-8').replace(/(src|srcset)="assets\//g, '$1="../assets/').replace(/, assets\//g, ', ../assets/');
const head = home.slice(home.indexOf('<!-- Styles are pre-built'), home.indexOf('</head>')).replace(/href="assets\//g, 'href="../assets/');
const sprite = home.slice(home.indexOf('<!-- Icons: Font Awesome'), home.indexOf('</svg>', home.indexOf('id="icon-sprite"')) + 6);
const storeLd = home.match(/<script type="application\/ld\+json">.*?<\/script>/s)[0];
const icon = home.match(/<link rel="icon"[^>]*>/)[0];

const call = (track, extra = '') => `<a href="tel:${schools.phone}" data-call="${esc(track)}" class="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full bg-brand-600 hover:bg-brand-700 text-white font-bold px-6 transition-colors ${extra}"><svg class="ic" viewBox="0 0 512 512" aria-hidden="true"><use href="#i-phone"/></svg> Call ${esc(schools.phoneDisplay)}</a>`;
const wab = (text) => `<a href="${esc(wa(text))}" target="_blank" rel="noopener" class="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full border-2 border-green-500 bg-white hover:bg-green-50 text-green-700 font-bold px-6 transition-colors"><svg class="ic" viewBox="0 0 448 512" aria-hidden="true"><use href="#i-whatsapp"/></svg> WhatsApp</a>`;

const live = shown;

function page(s) {
  const title = `${s.title} | Agrawal Stores, Rajendra Nagar, Indore`;
  const desc = `${s.intro} Visit Agrawal Stores, 57-B Rajendra Nagar, Indore, or call ${schools.phoneDisplay}.`.slice(0, 160);
  const fig = (p) => `<figure class="overflow-hidden rounded-2xl border-2 border-brand-100 bg-white"><button type="button" data-zoom aria-label="See larger photo: ${esc(p.caption)}" class="block w-full cursor-zoom-in"><img src="../assets/gallery/${esc(s.slug)}/thumb/${esc(p.file)}" srcset="../assets/gallery/${esc(s.slug)}/thumb/${esc(p.file)} 640w, ../assets/gallery/${esc(s.slug)}/${esc(p.file)} 1000w" sizes="(min-width: 768px) 300px, 46vw" data-full="../assets/gallery/${esc(s.slug)}/${esc(p.file)}" alt="${esc(s.title + ' ' + p.caption)}" width="1000" height="1250" loading="lazy" decoding="async" class="w-full aspect-[4/5] object-cover"></button><figcaption class="p-3 text-sm font-bold text-slate-700">${esc(p.caption)}</figcaption>${stockLine(p)}<div class="grid grid-cols-2 gap-2 px-3 pb-3"><a href="tel:${schools.phone}" data-call="${esc(s.slug)}:${esc(p.caption)}" aria-label="Call about ${esc(p.caption)}" class="flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-sm font-bold text-white"><svg class="ic" viewBox="0 0 512 512" aria-hidden="true"><use href="#i-phone"/></svg> Call</a><a href="${esc(wa(`Hello Agrawal Stores, I want to book: ${s.title} - ${p.caption}. Size/Class: `))}" target="_blank" rel="noopener" data-book="${esc(s.slug)}:${esc(p.caption)}" aria-label="Book ${esc(p.caption)} on WhatsApp" class="flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border-2 border-green-500 bg-white hover:bg-green-50 text-sm font-bold text-green-700"><svg class="ic" viewBox="0 0 448 512" aria-hidden="true"><use href="#i-whatsapp"/></svg> Book</a></div></figure>`;
  // Photos can carry a "group" (the Drive subfolder they came from); each group gets its own heading.
  const groups = [];
  for (const p of s.photos) { const g = p.group || ''; let e = groups.find((x) => x.name === g); if (!e) groups.push(e = { name: g, items: [] }); e.items.push(p); }
  const grid = groups.map((g) => `${g.name ? `<h3 class="mt-8 first:mt-0 mb-3 text-xl font-extrabold text-slate-800">${esc(g.name)}</h3>` : ''}<div class="grid grid-cols-2 md:grid-cols-3 gap-4">${g.items.map(fig).join('')}</div>`).join('\n            ');
  const others = live.filter((o) => o.slug !== s.slug);
  return `<!DOCTYPE html>
<!-- Generated by scripts/build-sections.mjs from data/sections.json. Edit those, not this file. -->
<html lang="en" class="scroll-smooth">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    ${icon}
    <title>${esc(title)}</title>
    <link rel="canonical" href="${SITE_URL}/sections/${s.slug}.html">
    <meta name="description" content="${esc(desc)}">
    <meta property="og:title" content="${esc(title)}">
    <meta property="og:description" content="${esc(desc)}">
    ${storeLd}
    ${head.trim()}
</head>
<body class="bg-brand-50 text-slate-800 antialiased">
    ${sprite}

    <nav class="bg-brand-600 text-white shadow-md sticky top-0 z-40">
        <div class="max-w-5xl mx-auto px-4 py-3 flex justify-between items-center gap-3">
            <a href="../index.html" class="flex items-center gap-2 min-h-[44px]">
                <svg class="ic text-2xl" viewBox="0 0 576 512" aria-hidden="true"><use href="#i-store"/></svg>
                <span class="text-xl font-extrabold tracking-wide">Agrawal Stores</span>
            </a>
            <a href="../index.html#products" class="inline-flex min-h-[44px] items-center rounded-full bg-brand-700 px-4 text-sm font-semibold">All sections</a>
        </div>
    </nav>

    <header class="bg-white border-b-4 border-brand-500 py-10 px-4 text-center">
        <div class="max-w-3xl mx-auto">
            <h1 class="text-3xl md:text-5xl font-extrabold text-slate-900 leading-tight break-words">${esc(s.title)} <span class="text-brand-600">at Agrawal Stores</span></h1>
            <p class="mt-4 text-lg text-slate-600">${esc(s.intro)}</p>
            <div class="mt-6 flex flex-col sm:flex-row justify-center gap-3">
                ${call(`${s.slug}:top`, 'text-lg')}
                ${wab(s.waText)}
            </div>
            <p class="mt-3 text-sm font-medium text-slate-500">Calls answered ${esc(schools.hours)}</p>
        </div>
    </header>

    <main class="max-w-5xl mx-auto px-4 py-10 space-y-14">
        <section aria-labelledby="stock-h">
            <h2 id="stock-h" class="text-2xl font-extrabold text-slate-800 mb-4">What we stock</h2>
            <ul class="grid gap-x-8 gap-y-2 sm:grid-cols-2 list-disc pl-6 marker:text-brand-500 text-lg text-slate-700">${(s.items || []).map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
        </section>

        <section aria-labelledby="photos-h">
            <h2 id="photos-h" class="text-2xl font-extrabold text-slate-800 mb-4">${s.photos.length ? 'A few things we stock' : 'Photos coming soon'}</h2>
            ${s.photos.length ? `<div>${grid}</div>` : `<p class="text-slate-600">We are adding photos of this section. Until then, call or WhatsApp us and we will tell you what we have.</p>`}
            <div class="mt-5 rounded-2xl bg-brand-100 p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <p class="font-bold text-brand-900">Looking for something specific? Call and we will tell you what we have.</p>
                ${call(`${s.slug}:ask`)}
            </div>
        </section>
${others.length ? `
        <section aria-labelledby="other-h">
            <h2 id="other-h" class="text-xl font-extrabold text-slate-800 mb-4">More from the store</h2>
            <div class="flex flex-wrap gap-2">
                ${others.map((o) => `<a href="${o.slug}.html" class="inline-flex min-h-[44px] items-center rounded-full bg-white border-2 border-brand-100 px-4 font-semibold text-slate-700 hover:border-brand-400">${esc(o.title)}</a>`).join('\n                ')}
            </div>
        </section>
` : ''}    </main>

    ${footer}

    <aside aria-label="Call or WhatsApp" class="sm:hidden fixed inset-x-0 bottom-0 z-50 grid grid-cols-[1fr_auto] gap-2 border-t border-brand-200 bg-white/95 p-3 backdrop-blur" style="padding-bottom:calc(0.75rem + env(safe-area-inset-bottom,0px))">
        <a href="tel:${schools.phone}" data-call="${esc(s.slug)}:bar" class="flex min-h-[48px] items-center justify-center gap-2 rounded-full bg-brand-600 font-extrabold text-white"><svg class="ic" viewBox="0 0 512 512" aria-hidden="true"><use href="#i-phone"/></svg> Call the store</a>
        <a href="${esc(wa(s.waText))}" target="_blank" rel="noopener" aria-label="WhatsApp Agrawal Stores" class="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-full bg-[#25D366] text-2xl text-white"><svg class="ic" viewBox="0 0 448 512" aria-hidden="true"><use href="#i-whatsapp"/></svg></a>
    </aside>
    <aside aria-label="Call or WhatsApp" class="hidden sm:flex fixed bottom-6 right-6 flex-col gap-4 z-50">
        <a href="tel:${schools.phone}" data-call="${esc(s.slug)}:float" aria-label="Call Agrawal Stores" class="bg-brand-500 hover:bg-brand-600 text-white w-14 h-14 rounded-full flex items-center justify-center shadow-lg"><svg class="ic text-2xl" viewBox="0 0 512 512" aria-hidden="true"><use href="#i-phone"/></svg></a>
        <a href="${esc(wa(s.waText))}" target="_blank" rel="noopener" aria-label="WhatsApp Agrawal Stores" class="bg-[#25D366] hover:bg-[#1ebd5a] text-white w-14 h-14 rounded-full flex items-center justify-center shadow-lg"><svg class="ic text-3xl" viewBox="0 0 448 512" aria-hidden="true"><use href="#i-whatsapp"/></svg></a>
    </aside>
${zoomDialog}
</body>
</html>
`;
}

const dir = path.join(root, 'sections');
rmSync(dir, { recursive: true, force: true });
if (live.length) { mkdirSync(dir, { recursive: true }); for (const s of live) writeFileSync(path.join(dir, `${s.slug}.html`), page(s)); }

// Home page section cards, generated from data/sections.json so new sections appear automatically.
// The "See ..." link stretches over the whole card (after:inset-0): tapping anywhere opens the section page.
const lines = (txt) => esc(txt).split('\n').join('<br>\n                    ');
const cardImage = (s) => s.image ? `assets/${s.image}` : (s.photos[0] ? `assets/gallery/${s.slug}/thumb/${s.photos[0].file}` : 'assets/categories/generic.svg');
const cardHtml = shown.map((s) => {
  const label = s.photos.length ? 'See photos' : 'See what we stock';
  const waText = s.waText || `Hello Agrawal Stores, I want to ask about ${s.title}`;
  return `
            <div class="relative bg-white p-6 rounded-2xl shadow-sm border-2 border-brand-100 hover:border-brand-300 hover:shadow-xl transition-all flex flex-col group">
                <a href="sections/${s.slug}.html" data-sec aria-label="${label}: ${esc(s.title)}" class="block"><div class="overflow-hidden rounded-xl mb-5">
                    <img src="${esc(cardImage(s))}" width="600" height="400" loading="lazy" alt="${esc(s.imageAlt || s.title)}" class="w-full aspect-[3/2] object-cover group-hover:scale-105 transition-transform duration-300">
                </div></a>
                <h3 class="font-extrabold text-2xl text-slate-800 mb-2 break-words">${esc(s.title)}</h3>
                <p class="text-slate-600 mb-4 flex-grow text-sm leading-relaxed">
                    ${lines(s.cardText || s.intro)}
                    <br><a href="sections/${s.slug}.html" aria-label="${label}: ${esc(s.title)}" class="mt-2 inline-flex min-h-[44px] items-center gap-1 font-bold text-brand-700 underline underline-offset-4 after:absolute after:inset-0 after:rounded-2xl after:content-['']">${label} <svg class="ic" viewBox="0 0 448 512" aria-hidden="true"><use href="#i-arrow-right"/></svg></a>
                </p>
                <div class="relative z-10 grid grid-cols-2 gap-3">
                    <a href="tel:${schools.phone}" class="flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold transition-colors"><svg class="ic" viewBox="0 0 512 512" aria-hidden="true"><use href="#i-phone"/></svg> Call</a>
                    <a aria-label="${esc(s.waLabel || `WhatsApp us about ${s.title}`)}" href="${esc(wa(waText))}" target="_blank" rel="noopener" class="flex min-h-[48px] items-center justify-center gap-2 rounded-xl border-2 border-green-500 bg-white hover:bg-green-50 text-green-700 font-bold transition-colors"><svg class="ic text-lg" viewBox="0 0 448 512" aria-hidden="true"><use href="#i-whatsapp"/></svg> WhatsApp</a>
                </div>
            </div>`;
}).join('\n');
if (!home.includes('<!--section-cards-->')) throw new Error('index.html is missing the <!--section-cards--> marker');
home = home.replace(/<!--section-cards-->[\s\S]*?<!--\/section-cards-->/, () => `<!--section-cards-->${cardHtml}\n            <!--/section-cards-->`);
writeFileSync(path.join(root, 'index.html'), home);
console.log(`Built ${live.length} section pages.`);
