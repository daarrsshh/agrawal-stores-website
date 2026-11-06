/** Styles for every page. Run `npm run build` after changing classes in index.html or scripts/build-schools.mjs. */
module.exports = {
  content: ['./index.html', './schools/**/*.html', './scripts/**/*.mjs'],
  theme: {
    extend: {
      colors: {
        // Warm rust brand colour. Change these to re-theme the whole site.
        brand: { 50: '#fffaf2', 100: '#fbefdf', 200: '#f3dcc2', 300: '#e2ae8f', 400: '#cf8160', 500: '#b9623f', 600: '#9c4a2e', 700: '#813c27', 800: '#6a3223', 900: '#572b1f' },
      },
    },
  },
};
