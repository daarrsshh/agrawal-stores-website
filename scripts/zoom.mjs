// Product pop-up: tapping a product photo opens it large with its name and the Call / Book buttons.
// Uses the browser's own <dialog>, so Esc, focus and screen readers work without extra code.
export const zoomDialog = `
    <dialog id="zoom" aria-labelledby="zoom-cap" class="m-auto w-[min(94vw,560px)] max-h-[94vh] overflow-y-auto rounded-3xl p-0 bg-white shadow-2xl backdrop:bg-slate-950/80">
        <div class="relative p-4">
            <button type="button" data-zoom-close aria-label="Close" class="absolute right-3 top-3 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-2xl font-bold text-slate-800 shadow">&times;</button>
            <img id="zoom-img" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" alt="" width="1000" height="1250" class="mx-auto max-h-[65vh] w-auto rounded-2xl object-contain">
            <p id="zoom-cap" class="mt-3 text-center text-lg font-extrabold text-slate-800"></p>
            <div id="zoom-stock" class="flex justify-center [&>p]:m-0 [&>p]:text-base"></div>
            <div class="mt-3 grid grid-cols-2 gap-3">
                <a id="zoom-call" href="#" class="flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-brand-600 hover:bg-brand-700 font-bold text-white"><svg class="ic" viewBox="0 0 512 512" aria-hidden="true"><use href="#i-phone"/></svg> Call</a>
                <a id="zoom-book" href="#" target="_blank" rel="noopener" class="flex min-h-[48px] items-center justify-center gap-2 rounded-xl border-2 border-green-500 bg-white hover:bg-green-50 font-bold text-green-700"><svg class="ic" viewBox="0 0 448 512" aria-hidden="true"><use href="#i-whatsapp"/></svg> Book</a>
            </div>
        </div>
    </dialog>
    <script>
        (function () {
            var d = document.getElementById('zoom');
            if (!d || !d.showModal) return; // very old browsers: the photo just stays as it is
            var img = document.getElementById('zoom-img'), cap = document.getElementById('zoom-cap');
            var call = document.getElementById('zoom-call'), book = document.getElementById('zoom-book');
            document.addEventListener('click', function (e) {
                var b = e.target.closest && e.target.closest('[data-zoom]');
                if (!b) return;
                var f = b.closest('figure'), src = f.querySelector('img');
                img.src = src.getAttribute('data-full') ? new URL(src.getAttribute('data-full'), location.href).href : (src.currentSrc || src.src); img.alt = src.alt;
                cap.textContent = f.querySelector('figcaption').textContent;
                var stk = f.querySelector('[data-stock]'); document.getElementById('zoom-stock').innerHTML = stk ? stk.outerHTML : '';
                var c = f.querySelector('a[href^="tel:"]'), w = f.querySelector('a[href*="wa.me"]');
                call.href = c.href; call.setAttribute('aria-label', c.getAttribute('aria-label'));
                book.href = w.href; book.setAttribute('aria-label', w.getAttribute('aria-label'));
                d.showModal();
                try { history.pushState({ zoom: 1 }, ''); } catch (x) {}
            });
            d.addEventListener('click', function (e) { if (e.target === d || e.target.closest('[data-zoom-close]')) d.close(); });
            d.addEventListener('close', function () { if (history.state && history.state.zoom) history.back(); });
            window.addEventListener('popstate', function () { if (d.open) d.close(); });
        })();
    </script>
`;
