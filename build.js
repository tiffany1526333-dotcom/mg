'use strict';
const { minify } = require('html-minifier-terser');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SRC_DIR = path.join(__dirname, 'src');
const SRC     = path.join(SRC_DIR, 'index.html');
const CSS     = path.join(SRC_DIR, 'styles.css');
const JS      = path.join(SRC_DIR, 'app.js');
const SW      = path.join(SRC_DIR, 'sw.js');
const MANIFEST = path.join(SRC_DIR, 'manifest.webmanifest');
const ICONS_DIR = path.join(SRC_DIR, 'icons');

const OUT_DIR = path.join(__dirname, 'dist', 'public');
const OUT     = path.join(OUT_DIR, 'index.html');

const MINIFY_OPTS = {
  collapseWhitespace: true,
  removeComments: true,
  removeRedundantAttributes: true,
  removeScriptTypeAttributes: true,
  removeStyleLinkTypeAttributes: true,
  useShortDoctype: true,
  minifyCSS: true,
  minifyJS: { compress: true, mangle: true },
};

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, entry.name);
    const d = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

async function build() {
  const apiBase = (process.env.API_BASE || '').replace(/\/$/, '');
  console.log(`Building… API_BASE=${apiBase || '(relative/same-origin)'}`);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  let src = fs.readFileSync(SRC, 'utf8');
  const css = fs.readFileSync(CSS, 'utf8');
  const js  = fs.readFileSync(JS, 'utf8');

  src = src.replace(
    /<link\s+rel="stylesheet"\s+href="styles\.css"\s*\/?>/,
    `<style>${css}</style>`,
  );
  src = src.replace(
    /<script\s+src="app\.js"\s*><\/script>/,
    `<script>${js}</script>`,
  );

  if (src.includes('href="styles.css"') || src.includes('src="app.js"')) {
    throw new Error('Failed to inline styles.css / app.js — check the link/script tags in src/index.html');
  }

  if (apiBase) {
    src = src.replace('</head>', `<script>window.__API_BASE__='${apiBase}'</script></head>`);
  }

  const minified = await minify(src, MINIFY_OPTS);
  fs.writeFileSync(OUT, minified);

  const swSource = fs.readFileSync(SW, 'utf8');
  const manifestSrc = fs.readFileSync(MANIFEST, 'utf8');
  const version = crypto.createHash('sha256')
    .update(minified).update(swSource).update(manifestSrc)
    .digest('hex').slice(0, 12);
  console.log(`  content version: ${version}`);

  const sw = swSource.replace(/__BUILD_VERSION__/g, version);
  fs.writeFileSync(path.join(OUT_DIR, 'sw.js'), sw);

  fs.copyFileSync(MANIFEST, path.join(OUT_DIR, 'manifest.webmanifest'));
  if (fs.existsSync(ICONS_DIR)) copyDir(ICONS_DIR, path.join(OUT_DIR, 'icons'));

  const srcSize = Buffer.byteLength(src, 'utf8');
  const outSize = Buffer.byteLength(minified, 'utf8');
  const pct = (((srcSize - outSize) / srcSize) * 100).toFixed(1);

  console.log(`✓ src/index.html (+ styles.css + app.js) → ${path.relative(__dirname, OUT)}`);
  console.log(`  ${(srcSize / 1024).toFixed(1)} KB → ${(outSize / 1024).toFixed(1)} KB  (${pct}% smaller)`);
  console.log(`✓ sw.js, manifest.webmanifest, icons/ → ${path.relative(__dirname, OUT_DIR)}`);
  console.log('Done. Serve with: NODE_ENV=production npm start');
}

build().catch(e => { console.error('Build failed:', e.message); process.exit(1); });
