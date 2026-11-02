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

Then run `node scripts/build-schools.mjs` and commit. `npm test` checks that the pages are up to date.
