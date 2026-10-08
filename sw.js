// オフライン対応（Service Worker）
// - アプリ本体・過去問DB・まとめノート・図: ネットワーク優先（最新を取得し、つながらない時は保存分を使う）
// - CDNのライブラリ: 保存分を優先（バージョン固定のため）
// - Gemini API: 保存しない（常に通信）
// 過去問DBのファイル名を変えたら、PRECACHE も合わせて更新し、CACHE_NAME の番号を上げる
const CACHE_NAME = 'quiz-cache-v1';
const NETWORK_TIMEOUT_MS = 4000;

const PRECACHE = [
  "./",
  "index.html",
  "viewer.html",
  "manifest.webmanifest",
  "Sanitary_Engineering_Exam_DB_v30.xlsx",
  "matome.xlsx",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
  "figures/H23-01.png",
  "figures/H23-08.png",
  "figures/H24-03.png",
  "figures/H24-06.png",
  "figures/H24-09.png",
  "figures/H25-04.png",
  "figures/H25-07.png",
  "figures/H26-01.png",
  "figures/H26-09.png",
  "figures/H26-23.png",
  "figures/H27-14.png",
  "figures/H27-17.png",
  "figures/H28-06.png",
  "figures/H28-15.png",
  "figures/H29-02.png",
  "figures/H29-09.png",
  "figures/H29-14.png",
  "figures/H30-04.png",
  "figures/R1%E5%86%8D-06.png",
  "figures/R1%E6%9C%AC-01.png",
  "figures/R1%E6%9C%AC-23.png",
  "figures/R2-01.png",
  "figures/R3-20.png",
  "figures/R4-11.png",
  "figures/R4-15.png",
  "figures/R5-04.png",
  "figures/R6-17.png",
  "figures/R7-02.png"
];

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
    // 1つ失敗しても他は保存する
    await Promise.allSettled([...PRECACHE, ...CDN_PRECACHE].map(async url => {
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

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok || res.type === 'opaque') cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request));
  } else if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(request));
  }
  // それ以外（Gemini APIなど）はブラウザに任せる
});
