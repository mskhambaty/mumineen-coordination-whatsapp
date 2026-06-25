# Self-hosted fonts

## KanzalMarjaan.woff2 (required for the quiz Lisan ud Dawat view)

The quiz page (`/quiz/[token]`) renders Lisan ud Dawat text in the **Kanz al-Marjaan** font.
Drop the font file here as **`KanzalMarjaan.woff2`** (woff2 preferred; a `.ttf`/`.otf` works too if you
also update the `@font-face` `src`/`format` in `src/app/quiz/[token]/page.tsx`).

Until the file is present, the Lisan view falls back to a generic Arabic naskh serif — the toggle,
RTL layout, and translations still work; only the typeface differs.
