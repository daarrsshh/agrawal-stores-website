// Builds one page per school into schools/<slug>.html from data/schools.json.
// Run: node scripts/build-schools.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zoomDialog } from './zoom.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE_URL = 'https://agrawalstores.in';
const data = JSON.parse(readFileSync(path.join(root, 'data/schools.json'), 'utf8'));
const home = readFileSync(path.join(root, 'index.html'), 'utf8');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const classLabel = (c) => (/^\d+$/.test(c) ? `Class ${c}` : c);
const classId = (c) => 'class-' + c.toLowerCase();
const wa = (text) => `https://wa.me/${data.phone.replace('+', '')}?text=${encodeURIComponent(text)}`;

// Footer is copied from the home page so address, numbers and map stay in one place.
const footer = home.slice(home.indexOf('<!-- Location & Footer -->'), home.indexOf('</footer>') + '</footer>'.length)
  .replace(/pb-44 md:pb-8/, 'pb-36 md:pb-8')
  .replace(/(src|srcset)="assets\//g, '$1="../assets/').replace(/, assets\//g, ', ../assets/');
const head = home.slice(home.indexOf('<!-- Styles are pre-built'), home.indexOf('</head>')).replace(/href="assets\//g, 'href="../assets/');
const sprite = home.slice(home.indexOf('<!-- Icons: Font Awesome'), home.indexOf('</svg>', home.indexOf('id="icon-sprite"')) + 6);
const storeLd = home.match(/<script type="application\/ld\+json">.*?<\/script>/s)[0];
const icon = home.match(/<link rel="icon"[^>]*>/)[0];

const callBtn = (label, track, extra = '') =>
  `<a href="tel:${data.phone}" data-call="${esc(track)}" class="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full bg-brand-600 hover:bg-brand-700 text-white font-bold px-6 transition-colors ${extra}"><svg class="ic" viewBox="0 0 512 512" aria-hidden="true"><use href="#i-phone"/></svg> ${esc(label)}</a>`;
const waBtn = (label, text, extra = '', aria = '') =>
  `<a${aria ? ` aria-label="${esc(aria)}"` : ''} href="${esc(wa(text))}" target="_blank" rel="noopener" class="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full border-2 border-green-500 bg-white hover:bg-green-50 text-green-700 font-bold px-6 transition-colors ${extra}"><svg class="ic" viewBox="0 0 448 512" aria-hidden="true"><use href="#i-whatsapp"/></svg> ${esc(label)}</a>`;

// Use the optimised .webp copy of a uniform photo when it exists (see npm run images).
const webFile = (slug, f) => { const w = f.replace(/\.(jpe?g|png)$/i, '.webp'); return existsSync(path.join(root, 'assets/uniforms', slug, w)) ? w : f; };

function page(s) {
  const title = `${s.fullName} Uniform & Books | Agrawal Stores, Rajendra Nagar, Indore`;
  const desc = `${s.fullName} uniforms (daily and winter) and ${data.session} book sets for every class at Agrawal Stores, 57-B Rajendra Nagar, Indore. Call ${data.phoneDisplay}.`.slice(0, 160);
  const others = data.schools.filter((o) => o.slug !== s.slug);

  const classes = data.classes.map((c) => {
    const books = s.books[c] || [];
    const list = books.length
      ? `<ol class="list-decimal pl-5 space-y-1 text-slate-700">${books.map((b) => `<li>${esc(b.title)}${b.publisher ? ` <span class="text-slate-500">(${esc(b.publisher)})</span>` : ''}</li>`).join('')}</ol>`
      : `<p class="text-slate-600">We have the ${esc(data.session)} book set for ${esc(classLabel(c))}. Call us and we will tell you the full list.</p>`;
    return `
        <details id="${classId(c)}" class="scroll-mt-28 sm:scroll-mt-20 group rounded-2xl border-2 border-brand-100 bg-white open:border-brand-300">
          <summary class="flex min-h-[56px] cursor-pointer list-none items-center justify-between gap-3 px-5 font-extrabold text-lg text-slate-800">
            <span>${esc(classLabel(c))} books${books.length ? ` <span class="ml-1 text-sm font-semibold text-slate-500">${books.length} items</span>` : ''}</span>
            <svg class="ic text-brand-600 transition-transform group-open:rotate-180" viewBox="0 0 512 512" aria-hidden="true"><use href="#i-chevron-down"/></svg>
          </summary>
          <div class="px-5 pb-5 space-y-4">
            ${list}
            <div class="grid gap-3 sm:grid-cols-2">
              ${callBtn(`Call for ${classLabel(c)} set price`, `${s.slug}:books:${c}`, 'w-full')}
              ${waBtn('WhatsApp', `Hello Agrawal Stores, I need the ${s.fullName} ${classLabel(c)} book set.`, 'w-full', `WhatsApp us about the ${classLabel(c)} book set`)}
            </div>
          </div>
        </details>`;
  }).join('');

  const fig = (p) => `<figure class="overflow-hidden rounded-2xl border-2 border-brand-100 bg-white"><button type="button" data-zoom aria-label="See larger photo: ${esc(p.caption)}" class="block w-full cursor-zoom-in"><img src="../assets/uniforms/${esc(s.slug)}/${esc(webFile(s.slug, p.file))}" alt="${esc(s.fullName + ' ' + p.caption)}" width="1000" height="1250" loading="lazy" decoding="async" class="w-full aspect-[4/5] object-cover"></button><figcaption class="p-3 text-sm font-bold text-slate-700">${esc(p.caption)}</figcaption><div class="grid grid-cols-2 gap-2 px-3 pb-3"><a href="tel:${data.phone}" data-call="${esc(s.slug)}:item" aria-label="Call about ${esc(p.caption)}" class="flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-sm font-bold text-white"><svg class="ic" viewBox="0 0 512 512" aria-hidden="true"><use href="#i-phone"/></svg> Call</a><a href="${esc(wa(`Hello Agrawal Stores, I want to book: ${s.fullName} - ${p.caption}. Size/Class: `))}" target="_blank" rel="noopener" data-book="${esc(s.slug)}:item" aria-label="Book ${esc(p.caption)} on WhatsApp" class="flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border-2 border-green-500 bg-white hover:bg-green-50 text-sm font-bold text-green-700"><svg class="ic" viewBox="0 0 448 512" aria-hidden="true"><use href="#i-whatsapp"/></svg> Book</a></div></figure>`;
  // Photos are shown under fixed headings so long pages are easy to scan on a phone.
  const ORDER = ['Daily wear', 'House & sports wear', 'Winter wear'];
  const groups = [];
  for (const p of s.uniformPhotos) { const g = p.group || 'Daily wear'; let e = groups.find((x) => x.name === g); if (!e) groups.push(e = { name: g, items: [] }); e.items.push(p); }
  groups.sort((a, b) => (ORDER.indexOf(a.name) + 1 || 99) - (ORDER.indexOf(b.name) + 1 || 99));
  const photos = s.uniformPhotos.length
    ? groups.map((g) => `${groups.length > 1 ? `<h3 class="mt-8 first:mt-0 mb-3 text-xl font-extrabold text-slate-800">${esc(g.name)}</h3>` : ''}<div class="grid grid-cols-2 md:grid-cols-3 gap-4">${g.items.map(fig).join('')}</div>`).join('\n            ')
    : `<ul class="grid gap-3 sm:grid-cols-2">
            <li class="rounded-2xl border-2 border-brand-100 bg-white p-5"><p class="font-extrabold text-slate-800">Daily uniform</p><p class="text-slate-600">For all classes, boys and girls.</p></li>
            <li class="rounded-2xl border-2 border-brand-100 bg-white p-5"><p class="font-extrabold text-slate-800">Winter wear</p><p class="text-slate-600">Blazers and sweaters.</p></li>
          </ul>`;
  // Uniform guide: what each class wears, taken from the school's own published list.
  const guide = (s.guide || []).length
    ? `<section id="guide" aria-labelledby="guide-h" class="scroll-mt-28 sm:scroll-mt-20">
            <h2 id="guide-h" class="text-2xl font-extrabold text-slate-800 mb-1">What your child needs</h2>
            <p class="text-slate-600 mb-5">The ${esc(s.fullName)} uniform by class, as the school lists it. Schools sometimes change details, so check the latest circular, or just call us.</p>
            <div class="grid gap-4 md:grid-cols-2">${s.guide.map((g) => `
                <div class="rounded-2xl border-2 border-brand-100 bg-white p-5"><h3 class="font-extrabold text-lg text-slate-800 mb-2">${esc(g.title)}</h3><ul class="list-disc pl-5 space-y-1 text-slate-700">${g.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>`).join('')}
            </div>
        </section>
`
    : '';


  return `<!DOCTYPE html>
<!-- Generated by scripts/build-schools.mjs from data/schools.json. Edit those, not this file. -->
<html lang="en" class="scroll-smooth">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    ${icon}
    <title>${esc(title)}</title>
    <link rel="canonical" href="${SITE_URL}/schools/${s.slug}.html">
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
            <a href="../index.html#schools" class="inline-flex min-h-[44px] items-center rounded-full bg-brand-700 px-4 text-sm font-semibold">All schools</a>
        </div>
    </nav>

    <header class="bg-white border-b-4 border-brand-500 py-10 px-4 text-center">
        <div class="max-w-3xl mx-auto">
            <div class="mx-auto mb-5 w-28 h-28 rounded-full border-[3px] border-brand-300 p-1 bg-white shadow-md flex items-center justify-center">
                <img src="../assets/${esc(s.logo)}" width="${s.logoW || 160}" height="${s.logoH || 160}" alt="${esc(s.fullName)} logo" class="max-w-[70%] max-h-[70%] object-contain">
            </div>
            <h1 class="text-3xl md:text-5xl font-extrabold text-slate-900 leading-tight break-words">${esc(s.fullName)} <span class="text-brand-600">Uniform &amp; Books</span></h1>
            <p class="mt-4 text-lg text-slate-600">Daily and winter uniforms, and ${esc(data.session)} book sets for every class, at Agrawal Stores, Rajendra Nagar, Indore.</p>
            <p lang="hi" class="mt-2 text-base font-semibold text-brand-700">${esc(s.fullName)} की यूनिफॉर्म और किताबें, अग्रवाल स्टोर्स, राजेंद्र नगर, इंदौर</p>
            <div class="mt-6 flex flex-col sm:flex-row justify-center gap-3">
                ${callBtn(`Call ${data.phoneDisplay}`, `${s.slug}:top`, 'text-lg')}
                ${waBtn('WhatsApp', `Hello Agrawal Stores, I need ${s.fullName} items for Class `)}
            </div>
            <p class="mt-3 text-sm font-medium text-slate-500">Calls answered ${esc(data.hours)}</p>
        </div>
    </header>

    <main class="max-w-5xl mx-auto px-4 py-10 space-y-14">

        <section aria-labelledby="pick-class">
            <h2 id="pick-class" class="text-2xl font-extrabold text-slate-800 mb-4">Choose your child's class</h2>
            <div class="flex flex-wrap gap-2">
                ${data.classes.map((c) => `<a href="#${classId(c)}" data-open="${classId(c)}" class="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border-2 border-brand-200 bg-white px-4 font-bold text-brand-800 hover:border-brand-400">${esc(c)}</a>`).join('\n                ')}
            </div>
        </section>

${guide}
        <section id="uniforms" aria-labelledby="uniforms-h" class="scroll-mt-28 sm:scroll-mt-20">
            <h2 id="uniforms-h" class="text-2xl font-extrabold text-slate-800 mb-4">${esc(s.fullName)} uniforms</h2>
            ${photos}
            <div class="mt-5 rounded-2xl bg-brand-100 p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <p class="font-bold text-brand-900">Not sure of the size? Call and we will check it for you.</p>
                ${callBtn('Call to check size', `${s.slug}:uniform`)}
            </div>
        </section>

        <section id="books" aria-labelledby="books-h" class="scroll-mt-28 sm:scroll-mt-20">
            <h2 id="books-h" class="text-2xl font-extrabold text-slate-800 mb-1">${esc(data.session)} book sets</h2>
            <p class="text-slate-600 mb-5">Tap your child's class to see the list. Call us for the set price and we will pack it for you.</p>
            <div class="space-y-3">${classes}
            </div>
        </section>

        <section aria-labelledby="how-h">
            <h2 id="how-h" class="text-2xl font-extrabold text-slate-800 mb-4">How it works</h2>
            <ol class="grid gap-3 sm:grid-cols-3">
                <li class="rounded-2xl bg-white border-2 border-brand-100 p-5"><span class="block text-3xl font-extrabold text-brand-600">1</span><span class="font-bold">Call us</span> with the school and class.</li>
                <li class="rounded-2xl bg-white border-2 border-brand-100 p-5"><span class="block text-3xl font-extrabold text-brand-600">2</span><span class="font-bold">We pack</span> the full set for you.</li>
                <li class="rounded-2xl bg-white border-2 border-brand-100 p-5"><span class="block text-3xl font-extrabold text-brand-600">3</span><span class="font-bold">Collect it</span> from our Rajendra Nagar store.</li>
            </ol>
        </section>

        <section aria-labelledby="faq-h">
            <h2 id="faq-h" class="text-2xl font-extrabold text-slate-800 mb-4">Common questions</h2>
            <div class="space-y-3">
                <details class="rounded-2xl bg-white border-2 border-brand-100 p-5"><summary class="flex min-h-[44px] cursor-pointer items-center font-bold">Do you have ${esc(s.fullName)} winter uniforms?</summary><p class="mt-2 text-slate-600">Yes. We keep blazers and sweaters along with the daily uniform.</p></details>
                <details class="rounded-2xl bg-white border-2 border-brand-100 p-5"><summary class="flex min-h-[44px] cursor-pointer items-center font-bold">Do you deliver?</summary><p class="mt-2 text-slate-600">No. Call us and we will keep your set packed and ready to collect from the store.</p></details>
                <details class="rounded-2xl bg-white border-2 border-brand-100 p-5"><summary class="flex min-h-[44px] cursor-pointer items-center font-bold">Where is the store and when is it open?</summary><p class="mt-2 text-slate-600">57-B, Rajendra Nagar, Indore 452012. ${esc(data.hours)}.</p></details>
            </div>
        </section>

        <section class="rounded-3xl bg-brand-600 text-white p-8 text-center">
            <h2 class="text-2xl md:text-3xl font-extrabold">Need anything for ${esc(s.fullName)}?</h2>
            <p class="mt-2 text-brand-100">Call ${esc(data.phoneDisplay)}, ${esc(data.hours)}.</p>
            <a href="tel:${data.phone}" data-call="${esc(s.slug)}:bottom" class="mt-5 inline-flex min-h-[52px] items-center justify-center gap-2 rounded-full bg-white px-8 text-lg font-extrabold text-brand-700 hover:bg-brand-50"><svg class="ic" viewBox="0 0 512 512" aria-hidden="true"><use href="#i-phone"/></svg> Call now</a>
        </section>

        <section aria-labelledby="other-h">
            <h2 id="other-h" class="text-xl font-extrabold text-slate-800 mb-4">Other schools we stock</h2>
            <div class="flex flex-wrap gap-2">
                ${others.map((o) => `<a href="${o.slug}.html" class="inline-flex min-h-[44px] items-center rounded-full bg-white border-2 border-brand-100 px-4 font-semibold text-slate-700 hover:border-brand-400">${esc(o.fullName)}</a>`).join('\n                ')}
            </div>
        </section>
    </main>

    ${footer}

    <!-- Call bar: fixed to the bottom on phones -->
    <aside aria-label="Call or WhatsApp" class="sm:hidden fixed inset-x-0 bottom-0 z-50 grid grid-cols-[1fr_auto] gap-2 border-t border-brand-200 bg-white/95 p-3 backdrop-blur" style="padding-bottom:calc(0.75rem + env(safe-area-inset-bottom,0px))">
        <a href="tel:${data.phone}" data-call="${esc(s.slug)}:bar" class="flex min-h-[48px] items-center justify-center gap-2 rounded-full bg-brand-600 font-extrabold text-white"><svg class="ic" viewBox="0 0 512 512" aria-hidden="true"><use href="#i-phone"/></svg> Call the store</a>
        <a href="${esc(wa(`Hello Agrawal Stores, I need ${s.fullName} items for Class `))}" target="_blank" rel="noopener" aria-label="WhatsApp Agrawal Stores" class="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-full bg-[#25D366] text-2xl text-white"><svg class="ic" viewBox="0 0 448 512" aria-hidden="true"><use href="#i-whatsapp"/></svg></a>
    </aside>
    <!-- Floating buttons on larger screens -->
    <aside aria-label="Call or WhatsApp" class="hidden sm:flex fixed bottom-6 right-6 flex-col gap-4 z-50">
        <a href="tel:${data.phone}" data-call="${esc(s.slug)}:float" aria-label="Call Agrawal Stores" class="bg-brand-500 hover:bg-brand-600 text-white w-14 h-14 rounded-full flex items-center justify-center shadow-lg"><svg class="ic text-2xl" viewBox="0 0 512 512" aria-hidden="true"><use href="#i-phone"/></svg></a>
        <a href="${esc(wa(`Hello Agrawal Stores, I need ${s.fullName} items for Class `))}" target="_blank" rel="noopener" aria-label="WhatsApp Agrawal Stores" class="bg-[#25D366] hover:bg-[#1ebd5a] text-white w-14 h-14 rounded-full flex items-center justify-center shadow-lg"><svg class="ic text-3xl" viewBox="0 0 448 512" aria-hidden="true"><use href="#i-whatsapp"/></svg></a>
    </aside>

    <script>
        // Tapping a class button opens that class's book list.
        function openFromHash() { var d = document.getElementById(location.hash.slice(1)); if (d && d.tagName === 'DETAILS') d.open = true; }
        window.addEventListener('hashchange', openFromHash); openFromHash();
    </script>
${zoomDialog}
</body>
</html>
`;
}

mkdirSync(path.join(root, 'schools'), { recursive: true });
for (const s of data.schools) writeFileSync(path.join(root, 'schools', `${s.slug}.html`), page(s));
// Sitemap and robots.txt for Google Search Console.
const sectionData = JSON.parse(readFileSync(path.join(root, 'data/sections.json'), 'utf8')).sections;
const urls = [`${SITE_URL}/`, ...data.schools.map((s) => `${SITE_URL}/schools/${s.slug}.html`), ...sectionData.filter((x) => x.photos.length).map((x) => `${SITE_URL}/sections/${x.slug}.html`)];
writeFileSync(path.join(root, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n')}\n</urlset>\n`);
writeFileSync(path.join(root, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /tests/\nDisallow: /scripts/\nDisallow: /data/\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
console.log(`Built ${data.schools.length} school pages.`);
await import('./build-sections.mjs');
