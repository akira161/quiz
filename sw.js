// オフライン対応（Service Worker）
// - アプリ本体・過去問DB・まとめノート: ネットワーク優先（最新を取得し、つながらない時は保存分を使う）
// - 問題画像: 保存分を優先
// - CDNのライブラリ: 保存分を優先（バージョン固定のため）
// - Gemini API: 保存しない（常に通信）
// 先に保存する一覧は tools/build_db.py が precache.json に書き出す。データを作り直したら CACHE_NAME の番号を上げる
const CACHE_NAME = 'quiz-cache-v2';
const NETWORK_TIMEOUT_MS = 4000;

// 先に保存するファイル（アプリ本体・科目DB・まとめノート・図が必要な問題の画像）の一覧は precache.json にある
// それ以外の問題画像は、開いたときに保存する

const CDN_PRECACHE = [
  "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
  "https://cdn.jsdelivr.net/npm/chart.js",
  "https://cdn.jsdelivr.net/npm/marked/marked.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.0.6/purify.min.js",
  "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js",
  "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css",
  "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js",
  "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"
];

const CDN_HOSTS = ["cdnjs.cloudflare.com", "cdn.jsdelivr.net"];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    let local = [];
    try { local = await (await fetch('precache.json', { cache: 'no-cache' })).json(); } catch (e) { /* 一覧が読めなくても続ける */ }
    // 1つ失敗しても他は保存する
    await Promise.allSettled([...local, ...CDN_PRECACHE].map(async url => {
      const res = await fetch(url, { cache: 'no-cache' });
      if (res.ok || res.type === 'opaque') await cache.put(url, res);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  // 検索パラメータ（?sheet= など）違いで別々に保存しないよう、パスだけをキーにする
  const key = request.url.split('?')[0];
  try {
    const res = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT_MS))
    ]);
    if (res.ok) cache.put(key, res.clone());
    return res;
  } catch (e) {
    const cached = await cache.match(key);
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const shell = await cache.match('index.html');
      if (shell) return shell;
    }
    throw e;
  }
}

// 通信が止まったままにならないよう、時間切れで失敗させる（画像の読み込みエラー表示につなげる）
function fetchWithTimeout(request, ms) {
  return Promise.race([
    fetch(request),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
  ]);
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetchWithTimeout(request, 10000);
  if (res.ok || res.type === 'opaque') cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    // 問題画像は問題IDごとに固定なので、保存分を優先する（データを作り直したら CACHE_NAME の番号を上げる）
    event.respondWith(url.pathname.includes('/figures/') ? cacheFirst(request) : networkFirst(request));
  } else if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(request));
  }
  // それ以外（Gemini APIなど）はブラウザに任せる
});
