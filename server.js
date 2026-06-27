'use strict';
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const LZString = require('lz-string');

const app = express();
const PORT = process.env.PORT || 3000;

const BASE_URL = 'https://www.manhuagui.com';
const CDN_HOSTS = ['eu.hamreus.com', 'eu2.hamreus.com', 'z6v2p9a8.bkcdn.net'];

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Referer': 'https://www.manhuagui.com/',
};

// Simple in-memory cache
const cache = new Map();
const CACHE_TTL = 3600_000; // 1 hour

function getCached(key) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.at < CACHE_TTL) return entry.data;
  return null;
}

function setCache(key, data) {
  cache.set(key, { at: Date.now(), data });
}

async function fetchHtml(url, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await axios.get(url, {
        headers: BROWSER_HEADERS,
        timeout: 15000,
        maxRedirects: 5,
      });
      return res.data;
    } catch (e) {
      if (i === retries) throw e;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

// Decode the Dean Edwards p,a,c,k,e,d packer using LZString keys
function decodePacker(p, a, c, k) {
  const e = n => (n < a ? '' : e(Math.floor(n / a))) + ((n = n % a) > 35 ? String.fromCharCode(n + 29) : n.toString(36));
  const d = {};
  while (c--) d[e(c)] = k[c] || e(c);
  return p.replace(/\b\w+\b/g, w => d[w] || w);
}

function parseChapterData(html) {
  // Structure: ...}('ENCODED_P', BASE, COUNT, 'LZDATA'['splic']('|'), 0, {})
  // Extract encoded p and LZString data using a direct regex on raw HTML
  const m = html.match(/\}\('([^']+)',(\d+),(\d+),'([A-Za-z0-9+/=]{30,})'\[/);
  if (!m) throw new Error('No packer script found in chapter page');

  const [, pEncoded, aStr, cStr, lzData] = m;
  const a = parseInt(aStr, 10);
  const c = parseInt(cStr, 10);

  // Site's custom String.splic = LZString.decompressFromBase64(this).split('|')
  const keys = LZString.decompressFromBase64(lzData).split('|');
  const decoded = decodePacker(pEncoded, a, c, keys);

  // Extract the JSON object from SMH.imgData({...})
  const jsonMatch = decoded.match(/SMH\.imgData\((\{[\s\S]+?\})\)\.preInit/);
  if (!jsonMatch) throw new Error('SMH.imgData not found in decoded script');

  try {
    return JSON.parse(jsonMatch[1]);
  } catch (_) {
    // eslint-disable-next-line no-new-func
    return Function('"use strict"; return (' + jsonMatch[1] + ')')();
  }
}

const isProd = process.env.NODE_ENV === 'production';
const staticDir = path.join(__dirname, isProd ? 'dist/public' : 'src');
app.use(express.static(staticDir, {
  setHeaders(res, filePath) {
    // The service worker must never be cached, or clients get stuck on an old build.
    if (filePath.endsWith('sw.js')) res.set('Cache-Control', 'no-cache');
  },
}));
app.use((_, res, next) => { res.set('Access-Control-Allow-Origin', '*'); next(); });

// Lightweight liveness probe (Render health check) — never scrapes upstream.
app.get('/healthz', (_, res) => res.json({ ok: true }));

// Parse the full update page once; split into per-day groups cached under 'home:groups'
async function fetchHomeGroups() {
  const cacheKey = 'home:groups';
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const html = await fetchHtml(`${BASE_URL}/update/`);
  const $ = cheerio.load(html);
  const groups = [];

  // Each date section: <h5> followed by <div class="latest-list">
  $('.latest-cont h5').each((_, h5) => {
    const listEl = $(h5).next('.latest-list');
    if (!listEl.length) return;
    const items = [];
    const seen = new Set();

    listEl.find('a').each((_, a) => {
      const href = ($(a).attr('href') || '').split('?')[0].replace(/\/$/, '');
      const bookId = href.match(/^\/comic\/(\d+)$/)?.[1];
      if (!bookId || seen.has(bookId)) return;
      const $img = $(a).find('img').first();
      const title = $img.attr('alt') || $(a).attr('title') || '';
      if (!title) return;
      let cover = $img.attr('data-src') || $img.attr('src') || `https://cf.mhgui.com/cpic/m/${bookId}.jpg`;
      if (cover.startsWith('//')) cover = 'https:' + cover;
      if (/hamreus\.com|bkcdn\.net/.test(cover)) cover = `https://cf.mhgui.com/cpic/m/${bookId}.jpg`;
      seen.add(bookId);
      items.push({ bookId, title, cover });
    });

    if (items.length) groups.push(items);
  });

  setCache(cacheKey, groups);
  return groups;
}

// ── GET /api/home ─────────────────────────────────────────────────────────────
app.get('/api/home', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  try {
    const groups = await fetchHomeGroups();
    const items = groups[page - 1] || [];
    const hasMore = page < groups.length;
    res.json({ items, hasMore });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/search ───────────────────────────────────────────────────────────
app.get('/api/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  const page = parseInt(req.query.page) || 1;
  if (!q) return res.json({ items: [] });

  try {
    const url = `${BASE_URL}/s/${encodeURIComponent(q)}_p${page}.html`;
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);
    const items = [];
    const seen = new Set();

    $('a[href*="/comic/"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const bookId = href.match(/\/comic\/(\d+)/)?.[1];
      if (!bookId || seen.has(bookId)) return;
      const $img = $(el).find('img').first();
      const title = $img.attr('alt') || $(el).attr('title') || $(el).text().trim() || '';
      if (!title) return;
      let cover = $img.attr('src') || $img.attr('data-src') || `//cf.mhgui.com/cpic/m/${bookId}.jpg`;
      if (cover.startsWith('//')) cover = 'https:' + cover;
      // Chapter thumbnails (hamreus CDN) need auth tokens — swap for the stable cover URL
      if (/hamreus\.com|bkcdn\.net/.test(cover)) cover = `https://cf.mhgui.com/cpic/m/${bookId}.jpg`;
      seen.add(bookId);
      items.push({ bookId, title, cover });
    });

    res.json({ items: items.slice(0, 24), hasMore: items.length >= 24 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/comic/:bookId ────────────────────────────────────────────────────
app.get('/api/comic/:bookId', async (req, res) => {
  const { bookId } = req.params;
  const cacheKey = `comic:${bookId}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  try {
    const html = await fetchHtml(`${BASE_URL}/comic/${bookId}/`);
    const $ = cheerio.load(html);

    const title = $('div.book-title h1, h1.book-title, h1').first().text().trim();
    const coverEl = $('.book-cover img, .comic-cover img').first();
    let cover = coverEl.attr('src') || coverEl.attr('data-src') || `https://cf.mhgui.com/cpic/m/${bookId}.jpg`;
    if (cover.startsWith('//')) cover = 'https:' + cover;
    const desc = $('.intro-desc, .book-intro p, #intro-all').first().text().trim();

    const chapters = [];
    const seen = new Set();

    // Try direct chapter links in chapter-list containers
    $('[id^="chapter-list"] a, .chapter-list a, ul.chapterList a').each((_, el) => {
      const href = $(el).attr('href') || '';
      const m = href.match(/\/comic\/\d+\/(\d+)\.html/);
      if (m && !seen.has(m[1])) {
        seen.add(m[1]);
        chapters.push({ chapterId: m[1], title: $(el).attr('title') || $(el).text().trim() || m[1] });
      }
    });

    // Fallback: all links matching the pattern
    if (chapters.length === 0) {
      $(`a[href*="/comic/${bookId}/"]`).each((_, el) => {
        const href = $(el).attr('href') || '';
        const m = href.match(/\/comic\/\d+\/(\d+)\.html/);
        if (m && !seen.has(m[1])) {
          seen.add(m[1]);
          chapters.push({ chapterId: m[1], title: $(el).attr('title') || $(el).text().trim() || m[1] });
        }
      });
    }

    chapters.sort((a, b) => parseInt(b.chapterId) - parseInt(a.chapterId));

    const result = { bookId, title, cover, desc, chapters };
    setCache(cacheKey, result);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/chapter/:bookId/:chapterId ───────────────────────────────────────
app.get('/api/chapter/:bookId/:chapterId', async (req, res) => {
  const { bookId, chapterId } = req.params;
  const cacheKey = `ch:${bookId}:${chapterId}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  try {
    const html = await fetchHtml(`${BASE_URL}/comic/${bookId}/${chapterId}.html`);

    if (html.includes('needVip') || html.includes('需要登录')) {
      return res.status(403).json({ error: '需要登录才能查看此章节' });
    }

    const raw = parseChapterData(html);
    const { path: imgPath, files = [], sl, bid, cid, cname, len, nextId, prevId, block_cc } = raw;

    if (block_cc) {
      return res.status(403).json({ error: `此内容在您所在地区不可用 (${block_cc})` });
    }

    const images = files.map((file, idx) => ({
      index: idx + 1,
      url: `https://${CDN_HOSTS[0]}${imgPath}${file}?e=${sl.e}&m=${sl.m}`,
      fallbackUrl: `https://${CDN_HOSTS[1]}${imgPath}${file}?e=${sl.e}&m=${sl.m}`,
    }));

    const result = {
      bookId: bid || +bookId,
      chapterId: cid || +chapterId,
      chapterName: cname || '',
      totalPages: len || files.length,
      nextId: nextId || null,
      prevId: prevId || null,
      images,
    };

    setCache(cacheKey, result);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/proxy ────────────────────────────────────────────────────────────
app.get('/api/proxy', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send('Missing url');

  let parsed;
  try { parsed = new URL(url); } catch (_) { return res.status(400).send('Invalid URL'); }

  const allowed = ['hamreus.com', 'mhgui.com', 'bkcdn.net'];
  if (!allowed.some(h => parsed.hostname.endsWith(h))) return res.status(403).send('Forbidden');

  try {
    const response = await axios({
      method: 'GET',
      url,
      responseType: 'stream',
      timeout: 20000,
      headers: {
        'User-Agent': BROWSER_HEADERS['User-Agent'],
        'Referer': 'https://www.manhuagui.com/',
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
      },
    });
    res.set('Content-Type', response.headers['content-type'] || 'image/webp');
    res.set('Cache-Control', 'public, max-age=7200');
    response.data.pipe(res);
  } catch (e) {
    res.status(e.response?.status || 500).send(e.message);
  }
});

// Two run shells, one app:
//  • `node server.js` (local/dev/Railway) → require.main === module → listen.
//  • Imported by api/[...path].js on Vercel → exported as a serverless handler.
if (require.main === module) {
  app.listen(PORT, () => console.log(`Combobox → http://localhost:${PORT}`));
}

module.exports = app;
