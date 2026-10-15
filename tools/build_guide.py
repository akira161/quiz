#!/usr/bin/env python3
"""過去問DB（data/*.xlsx）から「学習ガイド」用のデータ guide.json を作る。

論点（Issue）ごとに出題回数・出題年度・直近の頻度を集計し、
「最も不適切なもの／最も適切なものはどれか」型の問題から、過去問が正しいと認めている記述（正しい記述）と
誤りの記述を取り出して、論点ごとの「押さえるべき内容」としてまとめる。

使い方: python3 tools/build_guide.py
"""
import json
import os
import re
import sys
from collections import defaultdict

import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
from build_db import year_label  # noqa: E402

SUBJECTS = {
    'senmon': ('専門', '技術士第一次試験【専門科目】衛生工学部門'),
    'kiso': ('基礎', '技術士第一次試験【基礎科目】'),
    'tekisei': ('適性', '技術士第一次試験【適性科目】'),
}
NEG = re.compile(r'不適切|不適当|誤っ|誤り|適切でな|適当でな|正しくな|間違っ|異なる|あてはまらな|当てはまらな|含まれない|該当しない|ふさわしくな')
POS = re.compile(r'適切な|適当な|正しい|正しく|あてはまる|当てはまる|該当する|含まれる|ふさわしい')
SKIP_Q = re.compile(r'組合せ|組み合わせ|組合わせ|[（(][ア-エａ-ｄa-d][）)]|空欄|数値|計算|いくつ|何個|個数|最も大きい|最も小さい|大きい順|小さい順|順に|大小|値は|値を|式は|式を')


def era_year(code):
    m = re.fullmatch(r'([HR])(\d+)(再?)', code)
    n = int(m.group(2))
    return (1988 + n if m.group(1) == 'H' else 2018 + n) + (0.5 if m.group(3) else 0)


def bigrams(t):
    t = re.sub(r'\s+', '', t)
    return {t[i:i + 2] for i in range(len(t) - 1)}


def similar(a, b):
    if not a or not b:
        return False
    return len(a & b) / len(a | b) >= 0.6


def decision_sentence(text):
    for part in re.split(r'(?<=[。？?])', text):
        if re.search(r'どれか|選べ|はどれ', part):
            return part
    return ''


def clean(opt):
    opt = str(opt or '').strip()
    opt = re.sub(r'^[①-⑤1-5１-５][\.．\)）]?\s*', '', opt)
    return re.sub(r'\s+', ' ', opt)


def extract(row, answer_idx):
    """正しい記述・誤りの記述を取り出す。取り出せない問題は ([], [])"""
    text = str(row['問題文'] or '')
    if row.get('図表') == '要':
        return [], []
    stem = decision_sentence(text)
    if not stem or SKIP_Q.search(stem):
        return [], []
    opts = [clean(row.get(f'選択肢{c}')) for c in '①②③④⑤']
    if any(len(o) < 12 or len(o) > 220 for o in opts):
        return [], []
    if re.search(r'すべて|いずれも|上記', ''.join(opts)):
        return [], []
    if NEG.search(stem):
        true = [o for i, o in enumerate(opts) if i != answer_idx]
        false = [opts[answer_idx]]
    elif POS.search(stem):
        true = [opts[answer_idx]]
        false = [o for i, o in enumerate(opts) if i != answer_idx]
    else:
        return [], []
    return true, false


def main():
    out = {'subjects': {}}
    for key, (label, exam) in SUBJECTS.items():
        ws = openpyxl.load_workbook(os.path.join(ROOT, 'data', f'{key}.xlsx'), read_only=True).active
        rows = list(ws.iter_rows(values_only=True))
        head = rows[0]
        data = [dict(zip(head, r)) for r in rows[1:] if r and r[0]]
        newest = max(era_year(r['出典']) for r in data)
        years = sorted({r['出典'] for r in data}, key=era_year)
        genres = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
        for r in data:
            if key == 'senmon':
                mid = str(r.get('細目') or r['小分類']).strip()
            else:
                mid = re.split(r'[、,，]', str(r['小分類']))[0].strip()
            top = str(r['ブロック'] if key == 'senmon' else r['大分類']).strip()
            genres[top][mid][str(r['Issue']).strip()].append(r)

        items_all = []
        genre_list = []
        for g, mids in genres.items():
            items = []
            for mid, issues in mids.items():
                rowsm = [r for rs in issues.values() for r in rs]
                by_year = defaultdict(int)
                for r in rowsm:
                    by_year[year_label(r['出典'])] += 1
                score = sum(0.88 ** (newest - era_year(r['出典'])) for r in rowsm)
                prios = defaultdict(int)
                for r in rowsm:
                    prios[str(r['優先度'])] += 1
                iss = []
                for name, rs in issues.items():
                    rs = sorted(rs, key=lambda r: era_year(r['出典']), reverse=True)
                    ok, ng, seen_ok, seen_ng = [], [], [], []
                    themes = []
                    for r in rs:
                        ans = str(r['正答']).strip()
                        if not re.fullmatch(r'[1-5]', ans):
                            continue
                        t = str(r.get('テーマ概要') or '').strip()
                        if t and t not in themes:
                            themes.append(t)
                        tr, fl = extract(r, int(ans) - 1)
                        ref = [year_label(r['出典']), str(r['問題番号'])]
                        for lst, seen, dst in ((tr, seen_ok, ok), (fl, seen_ng, ng)):
                            for s in lst:
                                bg = bigrams(s)
                                if any(similar(bg, b) for b in seen):
                                    continue
                                seen.append(bg)
                                dst.append({'t': s, 'y': ref[0], 'q': ref[1]})
                    iss.append({
                        'name': name, 'n': len(rs),
                        'years': [year_label(r['出典']) for r in rs],
                        'ids': [(f"{year_label(r['出典'])}_{r['問題番号']}" if key == 'senmon' else f"{key}:{year_label(r['出典'])}_{r['問題番号']}") for r in rs],
                        'themes': themes[:4], 'ok': ok[:12], 'ng': ng[:6],
                    })
                iss.sort(key=lambda x: -x['n'])
                item = {'name': mid, 'n': len(rowsm), 'score': round(score, 2), 'byYear': dict(by_year),
                        'prios': dict(prios), 'issues': iss}
                items.append(item)
                items_all.append(item)
            items.sort(key=lambda x: -x['score'])
            genre_list.append({'name': g, 'n': sum(i['n'] for i in items), 'items': items})
        genre_list.sort(key=lambda x: -x['n'])
        # 優先ランク（直近の出題を重く見た得点の順）
        ranked = sorted(items_all, key=lambda x: -x['score'])
        for i, it in enumerate(ranked):
            f = i / len(ranked)
            it['rank'] = 'S' if f < 0.25 else 'A' if f < 0.6 else 'B' if f < 0.85 else 'C'
            it['order'] = i + 1
        n_stm = sum(len(x['ok']) for g in genre_list for it in g['items'] for x in it['issues'])
        out['subjects'][key] = {'label': label, 'examName': exam, 'nQ': len(data), 'years': [year_label(y) for y in years],
                                'genres': genre_list}
        print(f"{key}: 問題{len(data)} / 大分類{len(genre_list)} / 論点グループ{len(items_all)} / 論点{sum(len(i['issues']) for i in items_all)} / 正しい記述{n_stm}")
    path = os.path.join(ROOT, 'guide.json')
    json.dump(out, open(path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print('guide.json', round(os.path.getsize(path) / 1024), 'KB')


if __name__ == '__main__':
    main()
