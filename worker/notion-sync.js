// ブックマークをNotionデータベースへ自動で反映する中継サーバー（Cloudflare Workers）
//
// なぜ必要か: Notion APIはブラウザから直接呼べず（CORS）、呼ぶにはトークンが必要でアプリに埋め込めないため。
// このWorkerがアプリからの同期リクエストを受け取り、Notion APIを呼んで ページを作成・更新・（任意で）ゴミ箱へ移動する。
//
// 必要な設定（Cloudflare の「変数とシークレット」）:
//   NOTION_TOKEN        Notion内部インテグレーションのシークレット（シークレット）
//   NOTION_DATABASE_ID  ブックマーク用データベースのID（変数）
//   NOTION_MISTAKES_DATABASE_ID  間違えた問題用データベースのID（変数。使う場合のみ）
//   SYNC_KEY            アプリとWorkerだけが知る合言葉（シークレット。推測されにくい長い文字列）
//   ALLOWED_ORIGIN      アプリを開くサイトのオリジン（変数。例: https://akira161.github.io）
//
// API:
//   GET  /health  → 接続テスト（Notionデータベースの題名を返す）
//   POST /sync    → { target: 'bookmarks' | 'mistakes', items: [行...], removed: [問題ID...] } を反映

const NOTION = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';
const MAX_ITEMS = 20;     // 1回のリクエストで書き込む最大件数（Workersの外部呼び出し回数の上限に収める）
const sleep = ms => new Promise(r => setTimeout(r, ms));

function cors(env, req) {
  const origin = req.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
  const ok = allowed.includes(origin);   // 手元で試すときは ALLOWED_ORIGIN に http://localhost:8765 などを足す
  return {
    'Access-Control-Allow-Origin': ok ? origin : (allowed[0] || ''),
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Vary': 'Origin',
  };
}
function json(env, req, status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(env, req) } });
}

// 文字列比較を、長さや内容による時間差が出にくい形で行う
function safeEqual(a, b) {
  a = String(a || ''); b = String(b || '');
  let r = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) r |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return r === 0;
}

async function notion(env, method, path, body, attempt = 0) {
  const res = await fetch(NOTION + path, {
    method,
    headers: { Authorization: `Bearer ${env.NOTION_TOKEN}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 429 && attempt < 2) {
    await sleep((parseFloat(res.headers.get('Retry-After')) || 1) * 1000);
    return notion(env, method, path, body, attempt + 1);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Notion ${res.status}: ${data.message || res.statusText}`);
  return data;
}

// Notionのテキストは1要素2000文字まで
function rt(text, max = 6000) {
  text = String(text ?? '').slice(0, max);
  if (!text) return [];
  const out = [];
  for (let i = 0; i < text.length; i += 2000) out.push({ type: 'text', text: { content: text.slice(i, i + 2000) } });
  return out;
}
const sel = v => (v ? { select: { name: String(v).slice(0, 100) } } : { select: null });
const url = v => ({ url: /^https?:\/\//.test(v || '') ? v : null });

function propsOf(r) {
  const o = r.options || [];
  const p = {
    'タイトル': { title: rt(r.title, 200) },
    '科目': sel(r.subject), '種別': sel(r.kind), '復習ステータス': sel(r.status),
    '出典': { rich_text: rt(r.source, 200) }, '分野': { rich_text: rt(r.field, 300) },
    'メモ': { rich_text: rt(r.note, 2000) }, '正解': { rich_text: rt(r.correct, 100) },
    '問題文': { rich_text: rt(r.question) },
    '解説': { rich_text: rt(r.explanation) },
    '原本画像': url(r.image), 'まとめノート': url(r.noteUrl),
    '問題ID': { rich_text: rt(r.id, 300) },
  };
  for (let i = 0; i < 5; i++) p[`選択肢${i + 1}`] = { rich_text: rt(o[i], 1000) };
  p['登録日'] = /^\d{4}-\d{2}-\d{2}$/.test(r.date || '') ? { date: { start: r.date } } : { date: null };
  return p;
}

function mistakeProps(r) {
  const o = r.options || [];
  const p = {
    'タイトル': { title: rt(r.title, 200) },
    '科目': sel(r.subject), '状況': sel(r.status),
    '出典': { rich_text: rt(r.source, 200) }, '分野': { rich_text: rt(r.field, 300) },
    '間違えた回数': { number: Number.isFinite(+r.count) ? +r.count : 0 },
    '連続正解': { number: Number.isFinite(+r.streak) ? +r.streak : 0 },
    '最後に間違えた日': /^\d{4}-\d{2}-\d{2}$/.test(r.last || '') ? { date: { start: r.last } } : { date: null },
    'あなたの回答': { rich_text: rt(r.pick, 1000) },
    '正解': { rich_text: rt(r.correct, 100) }, '問題文': { rich_text: rt(r.question) }, '解説': { rich_text: rt(r.explanation) },
    '原本画像': url(r.image), 'まとめノート': url(r.noteUrl),
    '問題ID': { rich_text: rt(r.id, 300) },
  };
  for (let i = 0; i < 5; i++) p[`選択肢${i + 1}`] = { rich_text: rt(o[i], 1000) };
  return p;
}

// 新規ページの本文（読みやすさのため。更新時は本文には触れない）
function bodyOf(r) {
  const blocks = [];
  const para = (text, type = 'paragraph') => rt(text, 6000).length && blocks.push({ object: 'block', type, [type]: { rich_text: rt(text, 6000) } });
  para(r.question, 'quote');
  if (/^https?:\/\//.test(r.image || '')) blocks.push({ object: 'block', type: 'image', image: { type: 'external', external: { url: r.image } } });
  (r.options || []).forEach((o, i) => o && para(`${i + 1}. ${o}`));
  para(`正解: ${r.correct || '未登録'}`, 'heading_3');
  para(r.explanation);
  return blocks.slice(0, 100);
}

async function existingPages(env, dbId) {
  const map = new Map();   // 問題ID → ページID
  let cursor;
  for (let guard = 0; guard < 30; guard++) {
    const data = await notion(env, 'POST', `/databases/${dbId}/query`, { page_size: 100, start_cursor: cursor });
    for (const pg of data.results || []) {
      const id = ((pg.properties['問題ID'] || {}).rich_text || []).map(t => t.plain_text).join('');
      if (id) map.set(id, pg.id);
    }
    if (!data.has_more) break;
    cursor = data.next_cursor;
  }
  return map;
}

function targetOf(env, payload) {
  if (payload.target === 'mistakes') {
    if (!env.NOTION_MISTAKES_DATABASE_ID) throw Object.assign(new Error('Workerに NOTION_MISTAKES_DATABASE_ID（間違えた問題のデータベースID）が設定されていません'), { status: 400 });
    return { db: env.NOTION_MISTAKES_DATABASE_ID, props: mistakeProps };
  }
  return { db: env.NOTION_DATABASE_ID, props: propsOf };
}

async function handleSync(env, payload) {
  const { db, props } = targetOf(env, payload);
  const items = Array.isArray(payload.items) ? payload.items : [];
  const removed = Array.isArray(payload.removed) ? payload.removed.map(String) : [];
  if (items.length + removed.length > MAX_ITEMS * 2) throw Object.assign(new Error(`一度に送れるのは${MAX_ITEMS * 2}件までです`), { status: 413 });
  const result = { created: 0, updated: 0, archived: 0, done: [], failed: [] };
  const pages = await existingPages(env, db);
  for (const r of items) {
    if (!r || !r.id) continue;
    try {
      const pageId = pages.get(String(r.id));
      if (pageId) {
        await notion(env, 'PATCH', `/pages/${pageId}`, { properties: props(r), archived: false });
        result.updated++;
      } else {
        const pg = await notion(env, 'POST', '/pages', { parent: { database_id: db }, properties: props(r), children: bodyOf(r) });
        pages.set(String(r.id), pg.id);
        result.created++;
      }
      result.done.push(r.id);
      await sleep(340);   // Notionの制限（平均で毎秒3件）を守る
    } catch (e) {
      result.failed.push({ id: r.id, error: e.message });
    }
  }
  for (const id of removed) {
    try {
      const pageId = pages.get(id);
      if (pageId) { await notion(env, 'PATCH', `/pages/${pageId}`, { archived: true }); result.archived++; await sleep(340); }
      result.done.push(id);
    } catch (e) {
      result.failed.push({ id, error: e.message });
    }
  }
  return result;
}

export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env, req) });
    if (!env.NOTION_TOKEN || !env.NOTION_DATABASE_ID || !env.SYNC_KEY) return json(env, req, 500, { ok: false, error: 'Workerの設定（NOTION_TOKEN / NOTION_DATABASE_ID / SYNC_KEY）が足りません' });
    const auth = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!safeEqual(auth, env.SYNC_KEY)) return json(env, req, 401, { ok: false, error: '同期キーが違います' });
    try {
      if (u.pathname === '/health' && req.method === 'GET') {
        const db = await notion(env, 'GET', `/databases/${env.NOTION_DATABASE_ID}`);
        const title = (db.title || []).map(t => t.plain_text).join('');
        const need = ['タイトル', '問題ID', '復習ステータス'];
        const missing = need.filter(n => !(db.properties || {})[n]);
        if (missing.length) return json(env, req, 400, { ok: false, error: `データベースに列がありません: ${missing.join('、')}` });
        let mistakes = null;
        if (env.NOTION_MISTAKES_DATABASE_ID) {
          const mdb = await notion(env, 'GET', `/databases/${env.NOTION_MISTAKES_DATABASE_ID}`);
          mistakes = (mdb.title || []).map(t => t.plain_text).join('') || '（無題）';
        }
        return json(env, req, 200, { ok: true, database: title, mistakes });
      }
      if (u.pathname === '/sync' && req.method === 'POST') {
        const payload = await req.json();
        return json(env, req, 200, { ok: true, ...(await handleSync(env, payload)) });
      }
      return json(env, req, 404, { ok: false, error: 'not found' });
    } catch (e) {
      return json(env, req, e.status || 502, { ok: false, error: e.message });
    }
  },
};
