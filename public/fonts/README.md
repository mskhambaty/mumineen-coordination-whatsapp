# Self-hosted fonts

## KanzalMarjaan (quiz Lisan ud Dawat view) — present ✓

The quiz page (`/quiz/[token]`) renders Lisan ud Dawat text in the **Kanz al-Marjaan** font.
The font ships here as **`KanzalMarjaan.woff2`** (primary) with **`KanzalMarjaan.ttf`** as a
fallback; the `@font-face` in `src/app/quiz/[token]/page.tsx` references both.

To regenerate the woff2 from a `.ttf`:

```bash
python3 -c "from fontTools.ttLib import TTFont; f=TTFont('public/fonts/KanzalMarjaan.ttf'); f.flavor='woff2'; f.save('public/fonts/KanzalMarjaan.woff2')"
```

If the files are ever removed, the Lisan view falls back to a generic Arabic naskh serif — the
toggle, RTL layout, and translations still work; only the typeface differs.
