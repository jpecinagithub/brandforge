# seed-assets

Drop demo PNGs here (e.g. `cafe-aroma-logo.png`, `christmas-hero.png`).

`npm run db:seed` (and POST /api/v1/auth/demo) copies every `*.png` in this
directory into STORAGE_PATH and registers them as demo assets on the
"Café Aroma — Christmas Campaign" project. The seeding tolerates an empty
directory — it warns and continues.
