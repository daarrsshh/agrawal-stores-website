# agrawal-stores-website
Agrawal Stores website repository

## Tests

Automated checks for links, images, phone numbers, SEO tags, accessibility and layout at 320 to 1920px wide.

```
npm install
npx playwright install chromium
npm test
```

Needs an internet connection, because Tailwind loads from its CDN.

## School pages

Each school has its own page in `schools/`, built from `data/schools.json`. Don't edit the pages by hand.

To add a book list, open `data/schools.json` and fill in `books` for that school, one entry per class:

```json
"books": {
  "5": [
    { "title": "New Learning to Communicate 5", "publisher": "Oxford" },
    { "title": "Maths Magic 5" }
  ]
}
```

To add uniform photos, put them in `assets/uniforms/<school-slug>/` and list them under `uniformPhotos`:

```json
"uniformPhotos": [ { "file": "daily-boys.jpg", "caption": "Daily uniform (boys)" } ]
```

Then run `npm run build` and commit. `npm test` checks that the pages are up to date.

## Building

The site is plain HTML with pre-built styles, so it loads fast and GitHub Pages can serve it as is.

```
npm install          # once
npm run build        # rebuilds school pages and assets/site.css
npm run images       # shrinks new uniform photos to .webp
npm test
```

- Styles come from Tailwind classes in `index.html` and `scripts/build-schools.mjs`. After changing classes, run `npm run build` and commit `assets/site.css`.
- The brand colour is set once in `tailwind.config.js`.
- Icons are inline SVGs from Font Awesome Free (CC BY 4.0), defined once at the top of each page.

### Adding uniform photos

1. Put the phone photos in `assets/uniforms/<school-slug>/`, for example `assets/uniforms/st-norbert/daily-boys.jpg`.
2. List them in `data/schools.json` under that school's `uniformPhotos` (use the .jpg name).
3. Run `npm run images`, then `npm run build`, then `npm test`, and commit everything including the new `.webp` files.

Don't photograph children wearing the uniform; use hangers, folded sets or a mannequin.
