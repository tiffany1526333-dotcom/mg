'use strict';

/* ── Config (SSOT) ── */
const CONFIG = {
  APP_NAME : 'Combobox',
  API_BASE : (typeof window.__API_BASE__ === 'string') ? window.__API_BASE__ : '',
  HIST_KEY : 'cbx_hist',
  AUTH_KEY : 'cbx_auth',
  PASS     : '988999',
};

/* ── SVG icon library (Feather Icons, MIT) ── */
const ICONS = {
  home   : '<path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  search : '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  clock  : '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  chevL  : '<polyline points="15 18 9 12 15 6"/>',
  chevR  : '<polyline points="9 18 15 12 9 6"/>',
  inbox  : '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/>',
  warn   : '<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  book   : '<path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/>',
};

function ico(name, size=24, sw=2){
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

/* ── Password Gate ── */
(function(){
  const gate = document.getElementById('gate');
  if (localStorage.getItem(CONFIG.AUTH_KEY) === '1') return;
  gate.style.display = 'flex';
  setTimeout(() => document.getElementById('pinput').focus(), 60);
})();

window.checkPass = function(){
  const v = document.getElementById('pinput').value;
  const err = document.getElementById('gate-err');
  if (v === CONFIG.PASS) {
    localStorage.setItem(CONFIG.AUTH_KEY, '1');
    document.getElementById('gate').style.display = 'none';
  } else {
    err.textContent = '密码错误，请重试';
    document.getElementById('pinput').value = '';
    document.getElementById('pinput').focus();
    setTimeout(() => { err.textContent = ''; }, 2200);
  }
};

/* ── State ── */
const S = { view:'home', comic:null, chapter:null, stack:[] };

/* ── Pagination state ──────────────────────────────────────────────────────────
   page  : last page fetched (0 = nothing fetched yet)
   busy  : fetch in flight
   done  : no more pages to fetch
   io    : IntersectionObserver watching the sentinel element
   q     : current search query (search only)
── */
const pg = {
  home:   { page:0, busy:false, done:false, io:null },
  search: { page:0, busy:false, done:false, io:null, q:'' },
};

function resetPg(view){
  const s = pg[view];
  if (s.io) { s.io.disconnect(); s.io = null; }
  s.page = 0; s.busy = false; s.done = false;
  if (view === 'search') s.q = '';
}

/* ── Helpers ── */
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const proxy = url => `${CONFIG.API_BASE}/api/proxy?url=${encodeURIComponent(url)}`;

function toast(msg, ms=2200){
  const el=$('toast'); el.textContent=msg; el.classList.add('on');
  setTimeout(()=>el.classList.remove('on'), ms);
}

async function apiFetch(path){
  const r = await fetch(CONFIG.API_BASE + path);
  if(!r.ok){ const e=await r.json().catch(()=>({error:'HTTP '+r.status})); throw new Error(e.error||'HTTP '+r.status); }
  return r.json();
}

/* ── History store ── */
function getHist(){ try{ return JSON.parse(localStorage.getItem(CONFIG.HIST_KEY)||'[]'); }catch(_){ return []; } }
function addHist(item){
  const h=getHist().filter(x=>x.bookId!==item.bookId);
  h.unshift({...item, at:Date.now()});
  localStorage.setItem(CONFIG.HIST_KEY, JSON.stringify(h.slice(0,60)));
}

/* ── Navigation ── */
const TITLES = { home:CONFIG.APP_NAME, search:'搜索', history:'历史' };

function nav(view, params={}){
  if(S.view!==view) S.stack.push({view:S.view, ...curParams()});
  showView(view, params);
}

function goBack(){
  const p=S.stack.pop();
  if(p) showView(p.view, p);
}

function curParams(){
  if(S.view==='comic') return {bookId:S.comic?.bookId};
  if(S.view==='reader') return {bookId:S.chapter?.bookId, chapterId:S.chapter?.chapterId};
  return {};
}

function showView(view, params={}){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('on'));
  $('v-'+view).classList.add('on');
  S.view=view;

  const back=$('btn-back'), srch=$('btn-search-icon');
  const hdr=$('hdr'), navEl=$('nav'), rtbar=$('rtbar'), pbar=$('pbar');
  const tabs=['home','search','history'];

  if(view==='reader'){
    hdr.className='hdr reader';
    navEl.classList.add('hide');
    rtbar.classList.remove('show');
    pbar.style.width='0';
    tabs.forEach(t=>$('nb-'+t).classList.remove('on'));
  } else {
    hdr.className='';
    navEl.classList.remove('hide');
    rtbar.classList.remove('show');
    pbar.style.width='0';
    back.classList.toggle('on', !tabs.includes(view));
    srch.style.display=(view==='search'||view==='history')?'none':'';
    tabs.forEach(t=>$('nb-'+t).classList.toggle('on', t===view));
  }

  $('hdr-title').textContent = TITLES[view]
    || (view==='comic' ? S.comic?.title||'详情' : S.chapter?.chapterName||'阅读');

  refreshUpdateBar(); // hide the update banner in the reader, re-show it elsewhere

  if(view==='home') initHome();
  else if(view==='search') setTimeout(()=>{ const i=$('sinput'); if(i)i.focus(); },120);
  else if(view==='history') loadHistory();
  else if(view==='comic' && params.bookId) loadComic(params.bookId);
  else if(view==='reader' && params.bookId && params.chapterId) loadChapter(params.bookId, params.chapterId);
}

/* ── Home ── */
function initHome(){
  if(pg.home.page === 0 && !pg.home.busy) loadHome();
}

async function loadHome(){
  const s = pg.home;
  if(s.busy || s.done) return;
  s.busy = true;
  s.page++;
  const first = s.page === 1;

  if(first){
    $('home-body').innerHTML = spinner();
  } else {
    setLoadMore('home', 'loading');
  }

  try {
    const d = await apiFetch(`/api/home?page=${s.page}`);
    s.busy = false;
    const items = d.items || [];

    if(first){
      if(!items.length){
        $('home-body').innerHTML = emptyState(ico('inbox',44,1.5),'暂无内容');
        s.done = true;
        return;
      }
      $('home-body').innerHTML = `
        <div class="sec-h"><h2>最新更新</h2></div>
        <div id="home-grid" class="mgrid"></div>
        <div id="home-more" class="load-more"></div>`;

      s.io = new IntersectionObserver(([e]) => {
        if(e.isIntersecting && S.view === 'home') loadHome();
      }, { rootMargin:'200px' });
      s.io.observe($('home-more'));
    }

    appendCards($('home-grid'), items);
    lazyImgs($('home-grid'));

    if(!items.length || !d.hasMore){
      s.done = true;
      setLoadMore('home', 'done');
    } else {
      setLoadMore('home', 'idle');
    }
  } catch(e) {
    s.busy = false;
    s.page--;
    if(first){
      $('home-body').innerHTML = errState(e.message,'resetPg("home");initHome()');
    } else {
      setLoadMore('home', 'idle');
    }
  }
}

/* ── Search ── */
function startSearch(){
  const q = $('sinput').value.trim();
  if(!q) return;
  const s = pg.search;
  if(q !== s.q){
    resetPg('search');
    s.q = q;
  }
  if(s.page === 0 && !s.busy) loadSearch();
}

async function loadSearch(){
  const s = pg.search;
  if(s.busy || s.done || !s.q) return;
  s.busy = true;
  s.page++;
  const first = s.page === 1;

  if(first){
    $('search-body').innerHTML = spinner(`搜索"${esc(s.q)}"…`);
  } else {
    setLoadMore('search', 'loading');
  }

  try {
    const d = await apiFetch(`/api/search?q=${encodeURIComponent(s.q)}&page=${s.page}`);
    s.busy = false;
    const items = d.items || [];

    if(first){
      if(!items.length){
        $('search-body').innerHTML = emptyState(ico('search',44,1.5),`没有找到"${esc(s.q)}"`);
        s.done = true;
        return;
      }
      $('search-body').innerHTML = `
        <div class="sec-h"><h2 id="search-count">结果 (${items.length})</h2></div>
        <div id="search-grid" class="mgrid"></div>
        <div id="search-more" class="load-more"></div>`;

      s.io = new IntersectionObserver(([e]) => {
        if(e.isIntersecting && S.view === 'search') loadSearch();
      }, { rootMargin:'200px' });
      s.io.observe($('search-more'));
    }

    appendCards($('search-grid'), items);
    lazyImgs($('search-grid'));

    const cnt = $('search-count');
    if(cnt){ const grid=$('search-grid'); if(grid) cnt.textContent=`结果 (${grid.children.length})`; }

    if(!items.length || !d.hasMore){
      s.done = true;
      setLoadMore('search', 'done');
    } else {
      setLoadMore('search', 'idle');
    }
  } catch(e) {
    s.busy = false;
    s.page--;
    if(first){
      $('search-body').innerHTML = errState(e.message,'resetPg("search");startSearch()');
    } else {
      setLoadMore('search', 'idle');
    }
  }
}

/* ── Infinite scroll helpers ── */
function appendCards(grid, items){
  if(!grid) return;
  items.forEach(m => {
    const tmp = document.createElement('div');
    tmp.innerHTML = bookCard(m);
    if(tmp.firstElementChild) grid.appendChild(tmp.firstElementChild);
  });
}

function setLoadMore(view, state){
  const el = $(view+'-more');
  if(!el) return;
  el.className = state === 'done' ? 'load-end' : 'load-more';
  el.innerHTML = state === 'loading'
    ? `<div class="spin" style="width:28px;height:28px;border-width:2.5px"></div>`
    : state === 'done' ? '— 没有更多了 —' : '';
}

/* ── Detail view ── */
function openComic(bookId, title, cover){
  S.comic={bookId, title, cover};
  nav('comic',{bookId});
}

async function loadComic(bookId){
  $('comic-body').innerHTML=spinner();
  try{
    const d=await apiFetch(`/api/comic/${bookId}`);
    S.comic={bookId:d.bookId, title:d.title, cover:d.cover};
    $('hdr-title').textContent=d.title;

    const chHtml=d.chapters.length
      ? `<div class="clist-title">章节列表 (${d.chapters.length})</div><div class="cgrid">${
          d.chapters.map(c=>`<button class="cbtn" onclick="openChapter('${bookId}','${c.chapterId}','${esc(c.title).replace(/'/g,"\\'")}')"> ${esc(c.title)}</button>`).join('')
        }</div>`
      : emptyState(ico('inbox',44,1.5),'暂无章节');

    $('comic-body').innerHTML=`
      <div class="comic-hdr">
        <img class="comic-cov" src="${proxy(d.cover)}" onerror="this.style.background='var(--surf3)'" alt="${esc(d.title)}">
        <div class="comic-meta">
          <div class="comic-title">${esc(d.title)}</div>
          ${d.status?`<div class="comic-status">${esc(d.status)}</div>`:''}
        </div>
      </div>
      ${d.desc?`<div class="comic-desc">${esc(d.desc.slice(0,200))}${d.desc.length>200?'…':''}</div>`:''}
      ${chHtml}`;
  }catch(e){
    $('comic-body').innerHTML=errState(e.message,`loadComic('${bookId}')`);
  }
}

/* ── Chapter reader ── */
let obsv=null, tbarTimer=null, tbarOn=false;

function openChapter(bookId, chapterId, chapterName){
  if(S.comic) addHist({bookId, chapterId, title:S.comic.title||'', chapterName, cover:S.comic.cover||''});
  S.stack.push({view:S.view, ...curParams()});
  showView('reader',{bookId, chapterId});
}

async function loadChapter(bookId, chapterId){
  const pages=$('reader-pages'), pbar=$('pbar'), prog=$('rt-prog');
  pages.innerHTML=`<div class="spin-wrap" style="height:100vh"><div class="spin"></div><span>加载章节…</span></div>`;
  pbar.style.width='0';
  if(obsv){ obsv.disconnect(); obsv=null; }
  $('v-reader').onscroll=null;

  try{
    const d=await apiFetch(`/api/chapter/${bookId}/${chapterId}`);
    S.chapter=d;
    $('hdr-title').textContent=d.chapterName||'阅读';
    $('rt-prev').disabled=!d.prevId;
    $('rt-next').disabled=!d.nextId;
    prog.textContent=`0 / ${d.totalPages}`;

    pages.innerHTML=d.images.map((img,i)=>`
      <div class="rpage" id="rp${i+1}">
        <div class="rskel" id="rsk${i+1}"></div>
        <img data-src="${proxy(img.url)}" data-fb="${proxy(img.fallbackUrl)}" data-pi="${i+1}"
             style="display:none" alt="P${i+1}"
             onload="pgLoad(${i+1})" onerror="pgErr(${i+1},this)">
      </div>`).join('');

    obsv=new IntersectionObserver(entries=>{
      entries.forEach(e=>{
        if(!e.isIntersecting) return;
        const img=e.target.querySelector('img[data-src]');
        if(img && !img._loaded){ img._loaded=true; img.src=img.dataset.src; img.style.display=''; }
        obsv.unobserve(e.target);
      });
    },{rootMargin:'400px 0px'});

    document.querySelectorAll('.rpage').forEach(el=>obsv.observe(el));
    $('v-reader').onscroll=onReaderScroll;
  }catch(e){
    pages.innerHTML=`<div class="err-wrap" style="min-height:80vh"><div class="err-ic">${ico('warn',44,1.5)}</div><div>${esc(e.message)}</div><button class="err-btn" onclick="loadChapter('${bookId}','${chapterId}')">重试</button></div>`;
  }
}

function pgLoad(n){ const sk=$('rsk'+n); if(sk) sk.remove(); }

function pgErr(n, img){
  const fb=img.dataset.fb;
  if(fb && img.src!==fb){ img.src=fb; return; }
  const sk=$('rsk'+n);
  if(sk){ sk.className=''; sk.style=''; sk.innerHTML=`<div class="rerr"><div style="display:flex;align-items:center;gap:6px;color:var(--txt3)">${ico('warn',18,1.5)} 图片加载失败</div><button class="rbtn" onclick="pgRetry(${n})">重试</button></div>`; }
  img.style.display='none';
}

function pgRetry(n){
  const pg=$('rp'+n); if(!pg) return;
  const img=pg.querySelector('img'); if(!img) return;
  img._loaded=false; img.style.display=''; img.src='';
  setTimeout(()=>{ img.src=img.dataset.src; },50);
  const sk=pg.querySelector('.rskel')||pg.querySelector('div');
  if(sk){ sk.className='rskel'; sk.id='rsk'+n; sk.innerHTML=''; sk.style=''; }
}

function onReaderScroll(){
  const rv=$('v-reader');
  const {scrollTop,scrollHeight,clientHeight}=rv;
  const pct=scrollHeight>clientHeight ? Math.min(100,(scrollTop/(scrollHeight-clientHeight))*100) : 100;
  $('pbar').style.width=pct+'%';
  let cur=1;
  document.querySelectorAll('.rpage').forEach((p,i)=>{ if(p.getBoundingClientRect().top<=clientHeight/2) cur=i+1; });
  $('rt-prog').textContent=`${cur} / ${S.chapter?.totalPages||0}`;
}

function toggleTbar(){
  const hdr=$('hdr'), rt=$('rtbar');
  tbarOn=!tbarOn;
  if(tbarOn){
    hdr.classList.add('show'); rt.classList.add('show');
    clearTimeout(tbarTimer);
    tbarTimer=setTimeout(()=>{ hdr.classList.remove('show'); rt.classList.remove('show'); tbarOn=false; },3000);
  } else {
    hdr.classList.remove('show'); rt.classList.remove('show');
    clearTimeout(tbarTimer);
  }
}

function chNav(dir){
  if(!S.chapter) return;
  const id=dir==='next'?S.chapter.nextId:S.chapter.prevId;
  if(!id){ toast(dir==='next'?'已是最新章节':'已是第一章'); return; }
  loadChapter(S.chapter.bookId, id);
}

/* ── History view ── */
function loadHistory(){
  const hist=getHist();
  if(!hist.length){ $('history-body').innerHTML=emptyState(ico('book',44,1.5),'暂无阅读记录'); return; }
  $('history-body').innerHTML=`<div class="hlist">${hist.map(h=>`
    <div class="hitem" onclick="openComic('${h.bookId}','${esc(h.title).replace(/'/g,"\\'")}','${esc(h.cover).replace(/'/g,"\\'")}')">
      <img class="hcov" src="${proxy(h.cover)}" onerror="this.style.background='var(--surf3)'" alt="">
      <div class="hinfo">
        <div class="htitle">${esc(h.title)}</div>
        <div class="hchap">${esc(h.chapterName)}</div>
      </div>
    </div>`).join('')}</div>`;
}

/* ── Shared builders ── */
function bookCard(m){
  const fb = proxy(`https://cf.mhgui.com/cpic/m/${m.bookId}.jpg`);
  return `<div class="mcard" onclick="openComic('${m.bookId}','${esc(m.title).replace(/'/g,"\\'")}','${esc(m.cover).replace(/'/g,"\\'")}')">
    <div class="mcov-wrap"><img class="mcov lazy" data-src="${proxy(m.cover)}" data-fb="${fb}" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'%3E%3Crect fill='%23262626' width='1' height='1'/%3E%3C/svg%3E" alt="${esc(m.title)}" onerror="if(this.dataset.fb&&this.src!==this.dataset.fb){this.src=this.dataset.fb}else{this.style.opacity=0}"></div>
    <div class="mcov-title">${esc(m.title)}</div>
  </div>`;
}

function spinner(txt='加载中…'){ return `<div class="spin-wrap"><div class="spin"></div><span>${txt}</span></div>`; }
function emptyState(ic,msg){ return `<div class="empty"><div class="empty-ic">${ic}</div><div>${msg}</div></div>`; }
function errState(msg,retryCall){ return `<div class="err-wrap"><div class="err-ic">${ico('warn',44,1.5)}</div><div>${esc(msg)}</div><button class="err-btn" onclick="${retryCall}">重试</button></div>`; }

/* ── Lazy image loader ── */
function lazyImgs(root){
  const io=new IntersectionObserver(entries=>{
    entries.forEach(e=>{
      if(!e.isIntersecting) return;
      const img=e.target;
      if(img.dataset.src){ img.src=img.dataset.src; delete img.dataset.src; }
      io.unobserve(img);
    });
  },{rootMargin:'200px'});
  root.querySelectorAll('img.lazy').forEach(img=>io.observe(img));
}

/* ── PWA: service worker + update notification ──────────────────────────────────
   Flow: register sw.js → on `updatefound`, a new worker installs in the background.
   When it finishes installing AND a controller already exists (i.e. this is an
   update, not the first install), show the update banner. The user taps 「立即更新」,
   we tell the waiting worker to skipWaiting, then reload once it takes control so
   the freshest source code is served.
── */
let swWaiting = null;
let swUpdating = false;   // true once the user opts in, so controllerchange → reload
let updatePending = false; // a new version is waiting to be applied

function showUpdateBar(){
  updatePending = true;
  refreshUpdateBar();
}

// Show the banner only outside the reader — never cover the manga while reading.
// Called by showView() too, so leaving the reader re-reveals a pending update.
function refreshUpdateBar(){
  const bar = $('update-bar');
  if(bar) bar.classList.toggle('show', updatePending && S.view !== 'reader');
}

// Let the user hide the banner without updating; it returns on the next real version.
window.dismissUpdate = function(){
  updatePending = false;
  refreshUpdateBar();
};

window.applyUpdate = function(){
  updatePending = false;
  refreshUpdateBar();
  swUpdating = true;
  if(swWaiting){
    swWaiting.postMessage({ type:'SKIP_WAITING' });
  } else {
    location.reload();
  }
};

// Dev/LAN testing: a cached service worker keeps serving stale code, which makes
// "I changed it but the phone shows the old version" bugs. On localhost / private
// LAN IPs we DISABLE the SW entirely and actively tear down any existing one + caches,
// so every refresh shows the freshest source. Production keeps the SW (offline + updates).
const IS_DEV_HOST =
  ['localhost','127.0.0.1','0.0.0.0'].includes(location.hostname) ||
  /^192\.168\./.test(location.hostname) ||
  /^10\./.test(location.hostname) ||
  /^172\.(1[6-9]|2\d|3[01])\./.test(location.hostname);

if(IS_DEV_HOST){
  if('serviceWorker' in navigator){
    navigator.serviceWorker.getRegistrations()
      .then(rs => rs.forEach(r => r.unregister())).catch(()=>{});
  }
  if(window.caches){ caches.keys().then(ks => ks.forEach(k => caches.delete(k))).catch(()=>{}); }
} else if('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then(reg => {
      // A worker is already waiting (e.g. reopened the tab) → prompt immediately.
      if(reg.waiting && navigator.serviceWorker.controller){
        swWaiting = reg.waiting;
        showUpdateBar();
      }

      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if(!nw) return;
        nw.addEventListener('statechange', () => {
          if(nw.state === 'installed' && navigator.serviceWorker.controller){
            swWaiting = reg.waiting || nw;
            showUpdateBar();
          }
        });
      });

      // Re-check for a new deploy whenever the app regains focus.
      document.addEventListener('visibilitychange', () => {
        if(document.visibilityState === 'visible') reg.update().catch(()=>{});
      });
    }).catch(()=>{});

    // Reload only when the user opted into the update — never on the first install,
    // so a fresh visitor isn't bounced through a reload (and never sees the banner flash).
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if(!swUpdating) return;
      swUpdating = false;
      location.reload();
    });
  });
}

/* ── Boot ── */
loadHome();
