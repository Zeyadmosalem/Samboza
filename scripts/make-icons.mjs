/**
 * THE HOME-SCREEN ICON, DRAWN BY THE BROWSER THAT ALREADY DRIVES THE CHECKS.
 *
 *   node scripts/make-icons.mjs
 *
 * A PWA that installs without an icon gets a screenshot of the page or a
 * grey square with a letter Chrome picked, and on a family phone next to
 * WhatsApp that is the difference between an app and a bookmark. These are
 * generated rather than drawn by hand so they cannot drift from the mark the
 * app itself renders — same gradient, same weight, same letter, taken from
 * app/src/styles.css.
 *
 * Two shapes, because Android will mask whatever you give it:
 *   any       — rounded square, its own corners, used as supplied
 *   maskable  — full bleed, letter kept inside the 80% safe circle, so a
 *               device that crops to a circle does not cut the S in half
 * Supply only the first and Android pads it into a small icon floating in a
 * white blob. Supply only the second and desktop shows a square with no
 * corners at all.
 */
import { writeFileSync } from 'node:fs'
import { launch } from './lib/cdp.mjs'

const OUT = new URL('../app/public/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

/** Straight from styles.css — .brandmark and --accent / --accent-dark. */
const A = '#0f9d75', B = '#0b7d5e'

const page = (size, { maskable = false } = {}) => `data:text/html,${encodeURIComponent(`
<meta charset="utf-8">
<style>
  html,body { margin:0; padding:0; background:transparent; }
  .icon {
    width:${size}px; height:${size}px;
    border-radius:${maskable ? 0 : Math.round(size * 0.22)}px;
    background:linear-gradient(135deg, ${A}, ${B});
    display:grid; place-items:center;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
    font-weight:800; color:#fff;
    /* Maskable art is cropped to a circle of 80% on some devices, so the
       letter sits smaller and dead centre; the "any" icon has its own
       corners and can afford to fill more of the box. */
    font-size:${Math.round(size * (maskable ? 0.36 : 0.52))}px;
    line-height:1;
    letter-spacing:${maskable ? 0 : -Math.round(size * 0.01)}px;
  }
</style>
<div class="icon">S</div>`)}`

const ICONS = [
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  { file: 'icon-maskable-192.png', size: 192, maskable: true },
  { file: 'icon-maskable-512.png', size: 512, maskable: true },
  // iOS ignores the manifest and reads the link tag, and rounds the corners
  // itself — so it wants the full-bleed one, not the pre-rounded one.
  { file: 'apple-touch-icon.png', size: 180, maskable: true },
  { file: 'favicon-32.png', size: 32 },
]

const b = await launch(9370)
const p = await b.page()

for (const { file, size, maskable } of ICONS) {
  await p.go(page(size, { maskable }))
  const shot = await p.screenshot({
    clip: { x: 0, y: 0, width: size, height: size, scale: 1 },
    captureBeyondViewport: true,
  })
  const data = shot.result?.data
  if (!data) { console.error(`  FAILED  ${file}`); process.exitCode = 1; continue }
  const buf = Buffer.from(data, 'base64')
  writeFileSync(OUT + file, buf)
  console.log(`  ${file.padEnd(26)} ${size}x${size}  ${(buf.length / 1024).toFixed(1)} kB`)
}

b.close()
console.log(`\n  written to app/public/\n`)
