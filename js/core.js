// 技術士一次試験 過去問演習: 画面に依存しない処理（判定・数式の整形・日付・計画づくり・文章の似かた・AIの応答の処理）
// index.html より先に読み込む。tests/core.test.js で自動テストしている

// ===== 正答の判定 =====
// 正答が登録されているか（AI生成や旧形式の問題には hasAnswer がないので answer の有無で判定）
function hasAnswerOf(q) {
  return !!q.allCorrect || (q.hasAnswer !== false && Number.isInteger(q.answer) && q.answer >= 0);
}

function isCorrectAnswer(q, selectedIdx) {
  if (!hasAnswerOf(q)) return false;
  if (q.allCorrect) return true;
  return selectedIdx === q.answer || (q.alsoCorrect || []).includes(selectedIdx);
}

function correctIndexes(q) {
  if (!hasAnswerOf(q)) return [];
  if (q.allCorrect) return q.options.map((_, i) => i);
  return [q.answer, ...(q.alsoCorrect || [])];
}

// 正解の表示文（複数正解・全員正解に対応）
function correctLabel(q) {
  if (!hasAnswerOf(q)) return '（正答未登録）';
  if (q.allCorrect) return '全員正解（不適切な出題）';
  return [q.answer, ...(q.alsoCorrect || [])].map(i => i + 1).join(' または ');
}

// ===== 数式の整形 =====
// --- 数式の表示（AIが返す問題・解説に含まれるLaTeX） ---
// 「$...$」で囲まれていない生のLaTeX（\text{35.4 %} など）を、$...$ で囲んで数式として表示できるようにする
const MATH_SRC = String.raw`\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^$\n]+?\$`;

const BARE_LATEX_RE = new RegExp(String.raw`[^　-鿿＀-￯\n*#$]*(?:\\[a-zA-Z]+|[\^_]\{)[^　-鿿＀-￯\n*#$]*`, 'g');

function fixMathText(text) {
  const s = String(text ?? '');
  if (!/\\[a-zA-Z]|[\^_]\{/.test(s) && s.indexOf('%') < 0) return s;
  // TeXでは % が注釈の開始になり、後ろが消えてしまう。\text{ } の中では \% が使えないので、外に出して \% にする
  const escPct = m => m
    .replace(/\\(text|mathrm|mbox)\{([^{}]*)\}/g, (all, cmd, inner) => {
      inner = inner.replace(/\\%/g, '%');
      return inner.indexOf('%') < 0 ? all : inner.split('%').map(x => x ? `\\${cmd}{${x}}` : '').join('\\%');
    })
    .replace(/(?<!\\)%/g, '\\%');
  const wrapBare = seg => seg.replace(BARE_LATEX_RE, run => {
    const core = run.trim();
    if (!core) return run;
    const lead = run.slice(0, run.indexOf(core));
    return `${lead}$${escPct(core)}$${run.slice(lead.length + core.length)}`;
  });
  const re = new RegExp(MATH_SRC, 'g');
  let out = '', last = 0, m;
  while ((m = re.exec(s))) {
    out += wrapBare(s.slice(last, m.index)) + escPct(m[0]);
    last = m.index + m[0].length;
  }
  return out + wrapBare(s.slice(last));
}

// ===== 日付 =====
// 端末の日付（日本時間など、その土地の日付）で YYYY-MM-DD
function localDate(t = Date.now()) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(ds, n) { const [y, m, d] = ds.split('-').map(Number); return localDate(new Date(y, m - 1, d + n)); }

function dayDiff(a, b) { const f = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).getTime(); }; return Math.round((f(b) - f(a)) / 864e5); }

const isWeekendDate = ds => { const [y, m, d] = ds.split('-').map(Number); const w = new Date(y, m - 1, d).getDay(); return w === 0 || w === 6; };

const WEEK_JA = ['日', '月', '火', '水', '木', '金', '土'];

const dayLabel = ds => { const [y, m, d] = ds.split('-').map(Number); return `${m}/${d}（${WEEK_JA[new Date(y, m - 1, d).getDay()]}）`; };

const fmtMin = m => m >= 60 ? `${Math.floor(m / 60)}時間${m % 60 ? (m % 60) + '分' : ''}` : `${m}分`;

// ===== 学習スケジュール: 試験日までの毎日の計画を、正答状況と本試験の出題数から作る =====
const PLAN_MOCK_MIN = { senmon: 120, kiso: 60, tekisei: 60 };   // 腕試しの試験時間（分）。見直しに30分を足す

const MIN_PER_Q = 2;                                              // 過去問1問あたり（解く＋解説を読む）の目安（分）

// 計画を作る。today〜試験日の前日までの各日に、作業（tasks）を割り当てる
function buildPlan(an, cfg, today) {
  const left = dayDiff(today, cfg.examDate);
  const days = [];
  for (let i = 0; i < left; i++) {
    const date = addDays(today, i);
    const budget = isWeekendDate(date) ? cfg.weekend : cfg.weekday;
    days.push({ date, budget, left: budget, tasks: [] });
  }
  if (!days.length) return days;
  const add = (day, t) => { t.id = `${day.date}|${t.kind}|${t.subject || ''}|${t.genre || ''}`; day.tasks.push(t); day.left -= t.minutes; };
  const last = days[days.length - 1];
  const subjects = an.slice().sort((a, b) => a.rate - b.rate);   // 推定の低い科目から

  // 1) 前日: 間違えた問題の総復習と、まとめノートの見直し（軽め）
  if (days.length >= 2) {
    const half = Math.max(30, Math.round(last.budget / 2 / 10) * 10);
    add(last, { kind: 'mistakes', subject: '', minutes: half, title: '間違えた問題の総仕上げ（全科目）', note: '新しい問題より、間違えた問題・ブックマークを確実に' });
    add(last, { kind: 'notes', subject: subjects[0] ? subjects[0].key : 'senmon', minutes: Math.max(20, last.budget - half), title: 'まとめノート・学習ガイドで直前チェック', note: '数値・法令・用語を見直し、早めに寝る' });
  }
  // 2) 復習（腕試しより先に確保）: その日までに復習の時期が来る問題（間違えた問題を含む）を、科目ごとに解く。1問1.5分、1科目最大30分
  //    sub.dueTimes: 復習の時期（時刻）の一覧。前の日に復習した分は、先の日には数えない
  const reviewed = {};
  days.forEach(d => {
    if (d === last) return;
    const limit = endOfDay(d.date);
    subjects.forEach(sub => {
      const due = (sub.dueTimes || []).filter(t => t <= limit).length - (reviewed[sub.key] || 0);
      if (due <= 0 || d.left < 20) return;
      const minutes = Math.min(30, Math.max(10, Math.round(due * 1.5 / 5) * 5), d.left);
      const n = Math.min(due, Math.floor(minutes / 1.5));
      reviewed[sub.key] = (reviewed[sub.key] || 0) + n;
      add(d, { kind: 'review', subject: sub.key, minutes, n, title: `${SUBJECTS[sub.key].short}：今日の復習（${n}問）`, note: `間違えた問題・忘れかけた頃の問題（復習時期が来た${due}問から）` });
    });
  });

  // 3) 腕試し: 最後の1週間に各科目1回。日数に余裕があり、最近の腕試しがない科目は、最初の数日に実力確認として1回
  // 時間が足りる日（多くは土日）を優先。期間内に無ければ前後に広げ、それでも無ければ一番長く取れる日に置く
  const placeMock = (sub, from, to, why) => {
    const need = PLAN_MOCK_MIN[sub.key] + 30;
    const free = d => d !== last && !d.tasks.some(t => t.kind === 'mock');
    const inRange = days.slice(Math.max(0, from), Math.max(0, to) + 1).filter(free);
    let fit = inRange.filter(d => d.left >= need);
    if (!fit.length) fit = days.slice(Math.max(0, from - 3), Math.max(0, to) + 1).filter(d => free(d) && d.left >= need);
    const pickFrom = fit.length ? fit : (inRange.length ? inRange : days.filter(free));
    if (!pickFrom.length) return;
    const day = pickFrom.reduce((a, b) => (b.left > a.left ? b : a));
    add(day, { kind: 'mock', subject: sub.key, minutes: need, title: `${SUBJECTS[sub.key].short}科目の腕試し（本番形式・${PLAN_MOCK_MIN[sub.key]}分）＋見直し`, note: why + (day.left < 0 ? '　※この日は時間を多めに確保してください' : '') });
  };
  const n = days.length;
  const bySize = subjects.slice().sort((a, b) => PLAN_MOCK_MIN[b.key] - PLAN_MOCK_MIN[a.key]);   // 長い試験から、時間の取れる日を確保
  // 本番前の1週間に各科目1回
  bySize.forEach(sub => placeMock(sub, n - 7, n - 2, '本番の時間配分に慣れる'));
  // 日数に余裕があり、最近（14日以内）腕試しをしていない科目は、前半に実力確認として1回
  if (n >= 9) bySize.forEach(sub => { if (sub.lastMock == null) placeMock(sub, 0, n - 8, '今の実力を確かめ、弱点を見つける'); });

  // 4) 残りの時間: 弱い分野の過去問演習を30分単位で配る（出題数が多く、到達度が低い分野ほど多く）
  const target = 0.65;   // 合格ライン50%に余裕を持たせた目標
  const pool = [];
  subjects.forEach(sub => sub.genres.forEach(G => {
    const subW = 1 + Math.max(0, target - sub.rate) * 3;
    pool.push({ sub, G, w: G.exam * (1 - G.score) * subW * (1 + 0.5 * (1 - G.coverage)), alloc: 0, cap: Math.ceil((G.total - G.known) * MIN_PER_Q / 30) + 1 });
  }));
  days.forEach(d => {
    if (d === last) return;
    let guard = 0;
    while (d.left >= 20 && guard++ < 20) {
      const usedToday = g => d.tasks.filter(t => t.kind === 'practice' && t.subject === g.sub.key && t.genre === g.G.genre).reduce((a, t) => a + t.minutes, 0);
      const cand = pool.filter(g => g.alloc < g.cap && usedToday(g) < 60);
      if (!cand.length) break;
      const g = cand.reduce((a, b) => (b.w / (1 + b.alloc * 0.7) > a.w / (1 + a.alloc * 0.7) ? b : a));
      const m = Math.min(30, d.left);
      const ex = d.tasks.find(t => t.kind === 'practice' && t.subject === g.sub.key && t.genre === g.G.genre);
      if (ex) { ex.minutes += m; ex.n = Math.round(ex.minutes / MIN_PER_Q); d.left -= m; }
      else add(d, { kind: 'practice', subject: g.sub.key, genre: g.G.genre, minutes: m, n: Math.round(m / MIN_PER_Q), title: `${SUBJECTS[g.sub.key].short}：${g.G.genre}`, note: `到達度 ${Math.round(g.G.score * 100)}%・本試験で約${g.G.exam}問` });
      g.alloc++;
    }
  });
  days.forEach(d => d.tasks.forEach(t => { if (t.kind === 'practice') t.note = `${t.n}問（間違えた・未回答の問題から）・${t.note}`; }));
  return days;
}

// ===== 文章の似かた・抽選 =====
// 似かたのしきい値（重み付きの一致率）。実データ（専門の過去問）で、同じテーマの過去問どうしは中央値0.49、別テーマは99%が0.06以下。
// 重みなしの頃のしきい値（0.28 / 0.4 / 0.45 / 0.5 / 0.6）と同じテーマを同じ割合で見つける値より少し高めにし、決まり文句だけの一致で除外しすぎないようにした
const SIMILAR_THRESHOLD = 0.22;        // 同じ回の中で似た問題（旧0.28）
const HIST_TEXT_THRESHOLD = 0.36;      // 過去に出した問題と文章が似ている（旧0.4）
const HIST_REASON_THRESHOLD = 0.56;    // 過去に出した問題と「正解の根拠」が同じ（旧0.6）
const REASON_THRESHOLD = 0.42;         // 同じ回の中で「正解の根拠」が同じ（旧0.45）

function weightedPick(items, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return items[Math.floor(Math.random() * items.length)];
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) { r -= weights[i]; if (r <= 0) return items[i]; }
  return items[items.length - 1];
}

// 問題文＋選択肢を2文字ずつに区切った集合（文章の似かたの比較用）
function bigramsOf(text) {
  const t = String(text).replace(/[\s\u3000，。、．・「」（）()：:；;\-－]/g, '');
  const set = new Set();
  for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
  return set;
}

// 2文字の並びの「珍しさ」の重み（IDF）。「と定められている」「次の記述のうち」のような、どの問題にも出てくる言い回しは軽く、
// その問題に特有の語（物質名・数値・法令名など）は重くする。setBigramIdf に科目の全問題の文章を渡して作る
let BIGRAM_IDF = null, BIGRAM_IDF_N = 0;
const bigramTotals = new WeakMap();
function setBigramIdf(texts) {
  const df = new Map();
  texts.forEach(t => bigramsOf(t).forEach(x => df.set(x, (df.get(x) || 0) + 1)));
  BIGRAM_IDF = df.size ? df : null;
  BIGRAM_IDF_N = texts.length;
}
function bigramWeight(x) {
  if (!BIGRAM_IDF) return 1;
  return Math.log((BIGRAM_IDF_N + 1) / ((BIGRAM_IDF.get(x) || 0) + 1)) + 0.2;
}
function setWeight(set) {
  let c = bigramTotals.get(set);
  if (c && c.idf === BIGRAM_IDF) return c.total;
  let total = 0;
  set.forEach(x => { total += bigramWeight(x); });
  bigramTotals.set(set, { idf: BIGRAM_IDF, total });
  return total;
}
// 重み付きの一致率（重みがなければ、ふつうのジャカード係数）
function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  const [s, l] = a.size <= b.size ? [a, b] : [b, a];
  let inter = 0;
  s.forEach(x => { if (l.has(x)) inter += bigramWeight(x); });
  const union = setWeight(a) + setWeight(b) - inter;
  return union > 0 ? inter / union : 0;
}

// AIの問題が、過去問とほぼ同じ（流用）でないかを確かめる
const COPY_THRESHOLD = 0.45;           // 過去問とほぼ同じ（旧0.5）

// ===== AIの応答の処理 =====
// --- AI生成の中止 ---
class AiCancelled extends Error { constructor() { super('cancelled'); this.name = 'AiCancelled'; } }

// AIが答えたが、使える問題が1つもなかった（通信や認証のエラーとは区別する）
class AiNoUsable extends Error { constructor(msg) { super(msg); this.name = 'AiNoUsable'; } }

// APIが混雑・利用制限（429/503）で、待っても応答が得られなかった
class AiBusy extends Error { constructor(msg, waitMs) { super(msg); this.name = 'AiBusy'; this.waitMs = waitMs || 0; } }

function retryDelayMs(res, data) {
  let ms = 0;
  try {
    const details = (data && data.error && data.error.details) || [];
    const ri = details.find(d => d && d.retryDelay);
    if (ri) ms = parseFloat(String(ri.retryDelay)) * 1000;
  } catch (e) {}
  if (!(ms > 0)) ms = res.status === 429 ? 12000 : 4000;
  return Math.min(65000, ms + 500);
}

// ログ用に、APIのエラー（どの利用上限に当たったか・待つよう指定された時間）を短くまとめる
function apiErrSummary(data) {
  const e = (data && data.error) || {};
  const parts = [];
  (e.details || []).forEach(d => {
    (d.violations || []).forEach(x => { const id = x.quotaId || x.quotaMetric; if (id) parts.push(id.replace(/^.*\//, '') + (x.quotaValue ? `（上限${x.quotaValue}）` : '')); });
    if (d.retryDelay) parts.push(`再試行まで${d.retryDelay}`);
  });
  return parts.length ? parts.join(' / ') : String(e.message || '').slice(0, 120);
}

// AI詳細解説を生成する（混雑時は軽量モデルに切り替え）
// APIのエラーを、利用者向けの分かりやすい文にする
function friendlyApiError(status, data) {
  const detail = apiErrSummary(data);
  if (status === 429 && /PerDay/i.test(detail)) return '今日のGemini APIの利用上限（無料枠）に達しました。日本時間の16〜17時ごろに回復します。';
  if (status === 429) return 'Gemini APIの利用制限（1分あたりの回数）に達しました。1分ほど待ってから、もう一度お試しください。';
  if (status === 503 || status === 500) return 'Geminiが混雑しています（一時的なものです）。少し時間をおいて、もう一度お試しください。';
  if (status === 400 || status === 403) return `APIキーかリクエストに問題があります（${status}）。設定のAPIキーを確認してください。`;
  return `[${status}] ${(data && data.error && data.error.message) || '通信エラー'}`;
}

// --- AIの応答の検証・整形 ---
// JSON本文を取り出す（```json で囲まれていても、前後に説明文があっても読めるようにする）
// 応答の本文。複数のパートに分かれて返ることがあるので、思考（thought）以外をつなげる
function aiText(data) {
  const parts = (data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
  return parts.filter(p => !p.thought && typeof p.text === 'string').map(p => p.text).join('');
}

// AIがJSONの中にLaTeXをそのまま書くと（"\mathrm" "\times" など）、JSONとして読めない・\t がタブに化ける。
// 文字列中のバックスラッシュを、JSONのエスケープとして正しいもの以外は「\\」に直す
function repairJsonEscapes(t) {
  return t.replace(/\\([\s\S])/g, (m, c, off, str) => {
    if (c === '\\' || c === '"' || c === '/') return m;
    if ('bfnrt'.includes(c)) return /[a-zA-Z]/.test(str[off + 2] || '') ? '\\\\' + c : m;   // \times \frac \beta \nu \rho など
    if (c === 'u') return /^[0-9a-fA-F]{4}/.test(str.slice(off + 2, off + 6)) ? m : '\\\\u';
    return '\\\\' + c;
  });
}

// 文字列の中に、タブ・改ページなどの制御文字があるか（"\times" "\frac" が \t \f と読まれて化けたしるし）
function hasCtlChars(v) {
  if (typeof v === 'string') return /[\t\f\b]/.test(v);
  if (Array.isArray(v)) return v.some(hasCtlChars);
  if (v && typeof v === 'object') return Object.values(v).some(hasCtlChars);
  return false;
}
// AIの応答（JSON）を読む。形式を指定した応答（構造化出力）はそのまま読めるので、まずそのまま読み、
// 読めない・数式が化けている場合だけ、バックスラッシュを直してから読む。途中で切れていれば、完結している所までを読む
function parseAiJson(text) {
  let t = String(text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const a = t.indexOf('{'), a2 = t.indexOf('['), b = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  const start = a < 0 ? a2 : a2 < 0 ? a : Math.min(a, a2);
  if (start < 0 || b <= start) throw new AiNoUsable("AIの応答を読み取れませんでした（JSONがない）");
  t = t.slice(start, b + 1);
  try {
    const v = JSON.parse(t);
    if (!hasCtlChars(v)) return v;
  } catch (e) { /* 下で直して読む */ }
  const r = repairJsonEscapes(t);
  let first;
  for (const c of [r, r + ']}', r.slice(0, r.lastIndexOf('},') + 1) + ']}']) {
    try { return JSON.parse(c); } catch (e) { first = first || e; }
  }
  throw new AiNoUsable(`AIの応答を読み取れませんでした（${String(first.message).slice(0, 60)}）`);
}
function extractAiQuestionList(text) {
  const parsed = parseAiJson(text);
  let list = Array.isArray(parsed) ? parsed : parsed && parsed.questions;
  // "questions" 以外の名前で返ってきた場合も、問題の配列を探して使う
  if (!Array.isArray(list) && parsed && typeof parsed === 'object') list = Object.values(parsed).find(v => Array.isArray(v) && v.length && typeof v[0] === 'object');
  if (!Array.isArray(list) || list.length === 0) throw new AiNoUsable("AIの応答に問題が含まれていませんでした");
  return list;
}

// 選択肢の先頭の番号（①、1. 、(1) など）を取り除く。「1.5 m」のような数値は消さない
function stripOptionNumber(str) {
  return String(str ?? '').trim()
    .replace(/^[①-⑤]\s*/, '')
    .replace(/^[（(]?[1-5１-５][)）.．、:：]\s+/, '')
    .replace(/^選択肢\s*[1-5１-５]\s*[:：.．]\s*/, '')
    .trim();
}

const normOptionKey = str => String(str).replace(/[\s\u3000]/g, '').toLowerCase();

// 1問分を検証して整える。使えない場合は { ok: false, error } を返す
// 正答は「正解の選択肢の文章（correct_option）」を最優先にして特定し、番号（answer: 0〜4）はその次に使う（番号のずれによる誤採点を防ぐ）
// 問題文の「…ものはどれか」から、不適切を選ぶ(neg)か適切を選ぶ(pos)かを判定する（組合せ・計算・大小比較などはnull）
function stemKind(question) {
  const sent = (String(question).split(/(?<=[。？?])/).find(x => /どれか|選べ|はどれ/.test(x))) || '';
  if (!sent || /組合せ|組み合わせ|組合わせ|[（(][ア-エａ-ｄa-d][）)]|空欄|数値|計算|いくつ|何個|個数|最も大きい|最も小さい|大きい順|小さい順|順に|大小|値は|値を|式は|式を|最も近い/.test(sent)) return null;
  if (/不適切|不適当|誤っ|誤り|適切でな|適当でな|正しくな|間違っ|異なる|あてはまらな|当てはまらな|含まれない|該当しない|ふさわしくな/.test(sent)) return 'neg';
  if (/適切な|適当な|正しい|正しく|あてはまる|当てはまる|該当する|含まれる|ふさわしい/.test(sent)) return 'pos';
  return null;
}

function normalizeAiQuestion(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, error: '形式が不正' };
  const question = String(raw.question ?? '').trim();
  if (question.length < 8) return { ok: false, error: '問題文がない・短すぎる' };
  if (!Array.isArray(raw.options)) return { ok: false, error: '選択肢がない' };
  const options = raw.options.map(stripOptionNumber);
  if (options.length !== 5 || options.some(o => o === '')) return { ok: false, error: `選択肢が5つではない（${options.length}）` };
  if (new Set(options.map(normOptionKey)).size !== 5) return { ok: false, error: '同じ選択肢がある' };

  let idx = -1;
  const co = raw.correct_option ?? raw.correctOption;
  if (co != null && String(co).trim() !== '') {
    const key = normOptionKey(stripOptionNumber(co));
    const hits = options.map((o, i) => normOptionKey(o) === key ? i : -1).filter(i => i >= 0);
    if (hits.length === 1) idx = hits[0];
  }
  if (idx < 0) {
    let a = raw.answer;
    if (typeof a === 'string') {
      const t = a.trim().replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
      if (/^[①-⑤]$/.test(t)) a = t.charCodeAt(0) - 0x2460;                 // ①〜⑤ は番号（1始まり）の表記
      else if (/^(?:選択肢)?\s*[1-5]\s*(?:番)?$/.test(t) && /[選番]/.test(t)) a = parseInt(t.replace(/\D/g, ''), 10) - 1;
      else if (/^[0-9]+$/.test(t)) a = parseInt(t, 10);                      // 数字だけの文字列は、指示どおり0始まり
    }
    if (Number.isInteger(a) && a >= 0 && a <= 4) idx = a;
  }
  if (idx < 0) return { ok: false, error: '正答を特定できない' };

  // 「不適切（適切）なものを選ぶ」問題で、誤り（正しい）選択肢が2つ以上ある矛盾を弾く
  const kind = stemKind(question);
  const jr = raw.judgements ?? raw.judgments;
  if (kind && Array.isArray(jr) && jr.length === 5) {
    const j = jr.map(x => /^\s*(誤|×|✕|false|不適切|incorrect)/i.test(String(x)) ? '誤' : /^\s*(正|○|〇|true|適切|correct)/i.test(String(x)) ? '正' : '?');
    if (!j.includes('?')) {
      const wrong = j.filter(x => x === '誤').length;
      if (kind === 'neg') {
        if (wrong !== 1) return { ok: false, error: `誤りの選択肢が${wrong}つある（1つのはず）` };
        if (j[idx] !== '誤') return { ok: false, error: '正答の選択肢が「誤り」と判定されていない（矛盾）' };
      } else {
        if (5 - wrong !== 1) return { ok: false, error: `正しい選択肢が${5 - wrong}つある（1つのはず）` };
        if (j[idx] !== '正') return { ok: false, error: '正答の選択肢が「正しい」と判定されていない（矛盾）' };
      }
    }
  }
  return {
    ok: true,
    question: fixMathText(question),
    options: options.map(fixMathText),
    answer: idx,
    explanation: fixMathText(String(raw.explanation ?? raw.reason ?? '').trim()) || '（解説なし）',
    reason: String(raw.reason ?? '').trim().slice(0, 80),
    needExp: !String(raw.explanation ?? '').trim(),   // 詳しい解説は、問題を解いている間に別のAI呼び出しで作る
    theme: String(raw.theme ?? '').trim()
  };
}

// ===== AIの応答の形式（構造化出力）。Geminiに形式を指定すると、必ず読めるJSONで返ってくる =====
const SCHEMA_QUESTIONS = {
  type: 'OBJECT',
  properties: {
    questions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          theme: { type: 'STRING' },
          question: { type: 'STRING' },
          options: { type: 'ARRAY', items: { type: 'STRING' }, minItems: 5, maxItems: 5 },
          correct_option: { type: 'STRING' },
          answer: { type: 'INTEGER' },
          type: { type: 'STRING' },
          judgements: { type: 'ARRAY', items: { type: 'STRING', format: 'enum', enum: ['正', '誤'] }, minItems: 5, maxItems: 5 },
          reason: { type: 'STRING' }
        },
        required: ['question', 'options', 'correct_option', 'answer', 'judgements', 'reason'],
        propertyOrdering: ['theme', 'question', 'options', 'correct_option', 'answer', 'type', 'judgements', 'reason']
      }
    }
  },
  required: ['questions']
};
const SCHEMA_VERDICTS = {
  type: 'OBJECT',
  properties: {
    results: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          no: { type: 'INTEGER' },
          verdicts: { type: 'ARRAY', items: { type: 'STRING', format: 'enum', enum: ['正', '誤'] }, minItems: 5, maxItems: 5 },
          answer: { type: 'INTEGER' },
          flaw: { type: 'STRING' }
        },
        required: ['no', 'verdicts', 'answer', 'flaw'],
        propertyOrdering: ['no', 'verdicts', 'answer', 'flaw']
      }
    }
  },
  required: ['results']
};
const SCHEMA_EXPLANATIONS = {
  type: 'OBJECT',
  properties: {
    explanations: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { no: { type: 'INTEGER' }, text: { type: 'STRING' } }, required: ['no', 'text'], propertyOrdering: ['no', 'text'] }
    }
  },
  required: ['explanations']
};
// JSONで返してもらう呼び出しの generationConfig
const jsonConfig = schema => ({ response_mime_type: 'application/json', responseSchema: schema });

// ===== 間隔をあけた復習（忘れかけた頃にもう一度出す） =====
// 正解するたびに次の復習までの間隔を広げ（1→2→4→7→15→30日）、間違えたら翌日に戻す
const SRS_DAYS = [1, 2, 4, 7, 15, 30];
// h: 学習記録 { c: 正解した回数, w: 連続で間違えている数, n: 解いた回数, t: 最後に解いた時刻, b: 段階, due: 次に復習する時刻 }
function srsUpdate(h, ok, now = Date.now()) {
  h = h || { c: 0, w: 0 };
  h.n = (h.n || 0) + 1;
  h.t = now;
  if (ok) { h.c = (h.c || 0) + 1; h.w = 0; h.b = Math.min((h.b || 0) + 1, SRS_DAYS.length - 1); }
  else { h.w = (h.w || 0) + 1; h.b = 0; }
  h.due = now + SRS_DAYS[h.b] * 864e5;
  return h;
}
// 復習の時期が来ているか。以前の記録（時刻なし）は、間違えたままの問題だけを対象にする
function srsIsDue(h, now = Date.now()) {
  if (!h || (!h.c && !h.w)) return false;
  if (h.due) return h.due <= now;
  return h.w > 0;
}
// その日の終わり（23:59:59）の時刻
function endOfDay(ds) { const [y, m, d] = ds.split('-').map(Number); return new Date(y, m - 1, d, 23, 59, 59).getTime(); }

// 学習記録を、出題の優先度に使う重みにする（間違えたまま＞復習時期＞未回答＞覚えた問題。直前に解いた問題は控えめ）
function personalWeight(h, now = Date.now()) {
  let w;
  if (!h || (!h.c && !h.w)) w = 1;
  else if (h.w > 0) w = 3;
  else if (srsIsDue(h, now)) w = 2;
  else w = 0.5 / Math.max(1, h.b || 1);
  if (h && h.t && now - h.t < 12 * 3600e3) w *= 0.3;
  return w;
}

// Node.js のテストから読み込めるようにする（ブラウザでは何もしない）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { hasAnswerOf, isCorrectAnswer, correctIndexes, correctLabel, fixMathText, localDate, addDays, dayDiff, isWeekendDate, dayLabel, fmtMin,
    buildPlan, PLAN_MOCK_MIN, SIMILAR_THRESHOLD, HIST_TEXT_THRESHOLD, HIST_REASON_THRESHOLD, REASON_THRESHOLD, COPY_THRESHOLD, MIN_PER_Q, weightedPick, bigramsOf, jaccard, setBigramIdf, AiNoUsable, AiBusy, AiCancelled, retryDelayMs, apiErrSummary, friendlyApiError,
    aiText, repairJsonEscapes, parseAiJson, extractAiQuestionList, stripOptionNumber, stemKind, normalizeAiQuestion, SCHEMA_QUESTIONS, SCHEMA_VERDICTS, SCHEMA_EXPLANATIONS,
    jsonConfig, SRS_DAYS, srsUpdate, srsIsDue, endOfDay, personalWeight };
}
