// js/core.js の自動テスト（node --test tests/*.test.js で実行）
const test = require('node:test');
const assert = require('node:assert/strict');
global.SUBJECTS = {
  senmon: { short: '専門', label: '専門（衛生工学）' },
  kiso: { short: '基礎', label: '基礎科目' },
  tekisei: { short: '適性', label: '適性科目' }
};
const C = require('../js/core.js');

test('正答の判定（複数正解・全員正解・未登録）', () => {
  const q = { options: ['a', 'b', 'c', 'd', 'e'], answer: 2, alsoCorrect: [4] };
  assert.equal(C.isCorrectAnswer(q, 2), true);
  assert.equal(C.isCorrectAnswer(q, 4), true);
  assert.equal(C.isCorrectAnswer(q, 0), false);
  assert.equal(C.correctLabel(q), '3 または 5');
  assert.equal(C.isCorrectAnswer({ options: [], allCorrect: true }, 0), true);
  assert.equal(C.hasAnswerOf({ hasAnswer: false, answer: 1 }), false);
});

test('数式: $ で囲まれていないLaTeXを囲み、% をエスケープする', () => {
  assert.equal(C.fixMathText('濃度は \\text{35.4 %} である'), '濃度は $\\text{35.4 }\\%$ である');
  assert.equal(C.fixMathText('普通の文'), '普通の文');
  assert.equal(C.fixMathText('$x^2$ と y_{1}'), '$x^2$ と $y_{1}$');
});

test('日付: 端末の日付で計算する', () => {
  assert.equal(C.addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(C.dayDiff('2026-11-10', '2026-11-22'), 12);
  assert.equal(C.isWeekendDate('2026-11-14'), true);
  assert.equal(C.isWeekendDate('2026-11-16'), false);
  assert.equal(C.dayLabel('2026-11-22'), '11/22（日）');
  assert.equal(C.fmtMin(90), '1時間30分');
  assert.equal(C.localDate(new Date(2026, 0, 5, 1, 0).getTime()), '2026-01-05');
});

test('AIの応答: LaTeXのバックスラッシュが壊れていても読める', () => {
  const raw = String.raw`{"questions":[{"question":"BODが $20\,\mathrm{mg/L}$ で \times 2","options":["a","b","c","d","e"]}]}`;
  const list = C.extractAiQuestionList(raw);
  assert.equal(list[0].question, 'BODが $20\\,\\mathrm{mg/L}$ で \\times 2');
});

test('AIの応答: 正しいJSON（構造化出力）はそのまま読む。改行も壊さない', () => {
  const raw = JSON.stringify({ questions: [{ question: '1行目\nAの記述', options: ['$\\frac{1}{2}$', 'b', 'c', 'd', 'e'] }] });
  const list = C.extractAiQuestionList(raw);
  assert.equal(list[0].question, '1行目\nAの記述');
  assert.equal(list[0].options[0], '$\\frac{1}{2}$');
});

test('AIの応答: \\times が \\t（タブ）に化けた正しいJSONは直して読む', () => {
  const raw = '{"questions":[{"question":"2 \\times 3","options":[]}]}';   // JSONとしては \t（タブ）+ "imes"
  assert.equal(C.extractAiQuestionList(raw)[0].question, '2 \\times 3');
});

test('AIの応答: 途中で切れていても、完結した問題までは読む', () => {
  const raw = '{"questions":[{"question":"x"},{"question":"y"},{"question":"z';
  assert.deepEqual(C.extractAiQuestionList(raw).map(q => q.question), ['x', 'y']);
});

test('AIの問題の検証: 「不適切を選ぶ」で誤りが2つある問題は弾く', () => {
  const base = { question: '次の記述のうち、最も不適切なものはどれか。', options: ['あ', 'い', 'う', 'え', 'お'], correct_option: 'う' };
  assert.equal(C.normalizeAiQuestion({ ...base, judgements: ['正', '正', '誤', '正', '正'] }).ok, true);
  const bad = C.normalizeAiQuestion({ ...base, judgements: ['誤', '正', '誤', '正', '正'] });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /誤りの選択肢が2つ/);
  assert.equal(C.normalizeAiQuestion({ ...base, options: ['あ', 'あ', 'う', 'え', 'お'] }).ok, false);
});

test('AIの問題の検証: 正答は選択肢の文章から特定し、番号の表記ゆれも読む', () => {
  const q = { question: '次のうち最も適切なものはどれか。', options: ['1. あ', '2. い', '3. う', '4. え', '5. お'], correct_option: '4. え', answer: 0 };
  const r = C.normalizeAiQuestion(q);
  assert.equal(r.answer, 3);
  assert.deepEqual(r.options, ['あ', 'い', 'う', 'え', 'お']);
  assert.equal(C.normalizeAiQuestion({ ...q, correct_option: '', answer: '選択肢2' }).answer, 1);
});

test('問題文の形式（不適切を選ぶ/適切を選ぶ/計算など）', () => {
  assert.equal(C.stemKind('次の記述のうち、最も不適切なものはどれか。'), 'neg');
  assert.equal(C.stemKind('次の記述のうち、最も適切なものはどれか。'), 'pos');
  assert.equal(C.stemKind('次の値に最も近いものはどれか。'), null);
});

test('APIのエラー: 1日の上限・混雑を分かる言葉にする', () => {
  const daily = { error: { details: [{ violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', quotaValue: '500' }] }, { retryDelay: '1345s' }] } };
  assert.match(C.apiErrSummary(daily), /PerDay.*上限500.*1345s/);
  assert.match(C.friendlyApiError(429, daily), /今日の/);
  assert.match(C.friendlyApiError(503, {}), /混雑/);
  assert.equal(C.retryDelayMs({ status: 429 }, { error: { details: [{ retryDelay: '3s' }] } }), 3500);
});

test('似かた: 決まり文句だけが同じ文は、重み付きでは似ていない扱いになる', () => {
  const corpus = [];
  for (let i = 0; i < 40; i++) corpus.push(`次の記述のうち最も不適切なものはどれか。項目${i}は法令で定められている`);
  corpus.push('二酸化炭素の含有率は1000ppm以下と定められている', '浮遊粉じんの量は0.15mg以下と定められている');
  const a = C.bigramsOf('次の記述のうち最も不適切なものはどれか。二酸化炭素の含有率');
  const b = C.bigramsOf('次の記述のうち最も不適切なものはどれか。浮遊粉じんの量');
  C.setBigramIdf([]);
  const plain = C.jaccard(a, b);
  C.setBigramIdf(corpus);
  const weighted = C.jaccard(a, b);
  assert.ok(weighted < plain * 0.6, `plain=${plain} weighted=${weighted}`);
  assert.equal(C.jaccard(a, a), 1);
});

test('間隔をあけた復習: 正解で間隔が広がり、間違えると翌日に戻る', () => {
  const day = 864e5, t0 = Date.UTC(2026, 10, 10);
  let h = C.srsUpdate(null, true, t0);
  assert.equal(h.b, 1); assert.equal(h.due, t0 + 2 * day);
  h = C.srsUpdate(h, true, t0 + 2 * day);
  assert.equal(h.due, t0 + 2 * day + 4 * day);
  h = C.srsUpdate(h, false, t0 + 10 * day);
  assert.equal(h.b, 0); assert.equal(h.w, 1); assert.equal(h.due, t0 + 11 * day);
  assert.equal(h.n, 3); assert.equal(h.c, 2);
  assert.equal(C.srsIsDue(h, t0 + 10.5 * day), false);
  assert.equal(C.srsIsDue(h, t0 + 11 * day), true);
  assert.equal(C.srsIsDue({ c: 1, w: 0 }), false);   // 以前の記録（時刻なし）で正解済み → 対象外
  assert.equal(C.srsIsDue({ c: 0, w: 2 }), true);    // 以前の記録で間違えたまま → 対象
});

test('出題の重み: 間違えたまま＞未回答＞覚えた問題、直前に解いた問題は控えめ', () => {
  const now = Date.now();
  const wrong = C.personalWeight({ c: 0, w: 1, t: now - 864e5 }, now);
  const fresh = C.personalWeight(null, now);
  const known = C.personalWeight({ c: 3, w: 0, b: 3, due: now + 5 * 864e5, t: now - 2 * 864e5 }, now);
  const justNow = C.personalWeight({ c: 0, w: 1, t: now - 60e3 }, now);
  assert.ok(wrong > fresh && fresh > known, `${wrong} ${fresh} ${known}`);
  assert.ok(justNow < wrong);
});

function analysis() {
  const g = (genre, exam, score, total, coverage) => ({ genre, exam, score, total, known: Math.round(total * coverage * score), coverage });
  return [
    { key: 'senmon', rate: 0.55, lastMock: null, openMis: 5, dueTimes: [Date.now() - 1000, Date.now() - 1000], genres: [g('建築', 17, 0.5, 200, 0.4), g('水質', 7, 0.7, 100, 0.6), g('廃棄物', 11, 0.4, 150, 0.2)] },
    { key: 'kiso', rate: 0.35, lastMock: null, openMis: 0, dueTimes: [], genres: [g('設計', 6, 0.3, 90, 0.1), g('情報', 6, 0.4, 90, 0.1)] }
  ];
}

test('学習スケジュール: 試験日の前日までの毎日に、時間内で作業を割り当てる', () => {
  const cfg = { examDate: '2026-11-22', weekday: 90, weekend: 240, subjects: { senmon: true, kiso: true } };
  const days = C.buildPlan(analysis(), cfg, '2026-11-10');
  assert.equal(days.length, 12);
  assert.equal(days[0].date, '2026-11-10');
  assert.equal(days[11].date, '2026-11-21');
  // 前日は総仕上げだけ
  assert.deepEqual(days[11].tasks.map(t => t.kind).sort(), ['mistakes', 'notes']);
  // 各科目、最後の1週間に腕試しが1回ずつ。専門（120分）は時間の取れる日に置く
  const mocks = days.flatMap(d => d.tasks.filter(t => t.kind === 'mock').map(t => ({ d, t })));
  const lastWeek = mocks.filter(x => C.dayDiff(x.d.date, '2026-11-22') <= 7);
  assert.deepEqual(lastWeek.map(x => x.t.subject).sort(), ['kiso', 'senmon']);
  mocks.filter(x => x.t.subject === 'senmon').forEach(x => assert.ok(x.d.budget >= 150, x.d.date));
  // 1日の合計は、腕試しの日以外は予定時間を超えない
  days.forEach(d => { if (!d.tasks.some(t => t.kind === 'mock')) assert.ok(d.tasks.reduce((a, t) => a + t.minutes, 0) <= d.budget, d.date); });
  // 復習は時期が来ている専門だけ。1日目にまとめて入る
  const reviews = days.flatMap(d => d.tasks.filter(t => t.kind === 'review'));
  assert.ok(reviews.length >= 1 && reviews.every(t => t.subject === 'senmon'));
  assert.equal(reviews.reduce((a, t) => a + t.n, 0), 2);
  // 演習は、到達度の低い基礎の方に多く
  const minutes = k => days.flatMap(d => d.tasks).filter(t => t.kind === 'practice' && t.subject === k).reduce((a, t) => a + t.minutes, 0);
  assert.ok(minutes('kiso') > 0 && minutes('senmon') > 0);
  // 作業IDは日ごとに重複しない
  days.forEach(d => assert.equal(new Set(d.tasks.map(t => t.id)).size, d.tasks.length));
});

test('学習スケジュール: 試験日当日・過ぎた日は計画なし', () => {
  const cfg = { examDate: '2026-11-22', weekday: 90, weekend: 240, subjects: { senmon: true } };
  assert.equal(C.buildPlan(analysis(), cfg, '2026-11-22').length, 0);
  assert.equal(C.buildPlan(analysis(), cfg, '2026-11-25').length, 0);
});

test('構造化出力の形式: 必須項目がそろっている', () => {
  assert.deepEqual(C.SCHEMA_QUESTIONS.required, ['questions']);
  assert.ok(C.SCHEMA_QUESTIONS.properties.questions.items.required.includes('correct_option'));
  assert.equal(C.jsonConfig(C.SCHEMA_VERDICTS).response_mime_type, 'application/json');
});
