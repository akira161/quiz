#!/usr/bin/env python3
"""基礎・適性科目のまとめノート（matome_kiso.xlsx / matome_tekisei.xlsx）を作る。

内容は tools/matome_kiso_content.py / matome_tekisei_content.py に書いてある。
出題実績と頻度マップは guide.json（tools/build_guide.py で作る）から自動で付ける。
過去問の論点グループ（guide.json）に対応するノートが無い、または余分なノートがあれば、エラーで止まる。

使い方: python3 tools/build_guide.py && python3 tools/build_matome.py
"""
import json
import os
import re
import sys

import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
from matome_kiso_content import KISO  # noqa: E402
from matome_tekisei_content import TEKISEI  # noqa: E402

NUMS = '①②③④⑤⑥⑦⑧⑨'
HEADER = ['分野', '項目', '必須キーワード・概念', '要点（定義・公式・数値）', '出題ポイント（正誤の引っかけ）', '出題実績（過去問）']
SUBJECTS = {
    'kiso': dict(content=KISO, title='技術士第一次試験 基礎科目 出題範囲 完全まとめノート', file='matome_kiso.xlsx',
                 sub='過去16年(H23〜R7)・470問の出題を分析し、5つの分野（群）の全論点の要点・公式・数値・正誤の引っかけを収録', code='K'),
    'tekisei': dict(content=TEKISEI, title='技術士第一次試験 適性科目 出題範囲 完全まとめノート', file='matome_tekisei.xlsx',
                    sub='過去16年(H23〜R7)・240問の出題を分析し、5つの分野の全論点の条文・制度・事例判断の要点と正誤の引っかけを収録', code='T'),
}
FILL_H = PatternFill('solid', fgColor='4338CA')
WIDTHS = [18, 22, 36, 90, 52, 36]


def short_year(y):
    y = y.replace('令和元年度(本試験)', 'R1本').replace('令和元年度(再試験)', 'R1再')
    return y.replace('平成', 'H').replace('令和', 'R').replace('年度', '')


def style_sheet(ws, header_row, widths, ncols):
    for i, w in enumerate(widths, start=2):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws['B2'].font = Font(bold=True, size=14, color='4338CA')
    for c in range(2, 2 + ncols):
        cell = ws.cell(header_row, c)
        cell.font = Font(bold=True, color='FFFFFF')
        cell.fill = FILL_H
        cell.alignment = Alignment(wrap_text=True, vertical='center')
    for row in ws.iter_rows(min_row=header_row + 1, min_col=2, max_col=1 + ncols):
        for cell in row:
            cell.alignment = Alignment(wrap_text=True, vertical='top')
    ws.freeze_panes = ws.cell(header_row + 1, 2)


def add_sheet(wb, name, title, sub, header, rows, widths):
    ws = wb.create_sheet(name[:31])
    ws['B2'] = title
    ws['B3'] = sub
    for j, h in enumerate(header, start=2):
        ws.cell(4, j, h)
    for i, r in enumerate(rows, start=5):
        for j, v in enumerate(r, start=2):
            ws.cell(i, j, v)
    style_sheet(ws, 4, widths, len(header))
    return ws


def main():
    guide = json.load(open(os.path.join(ROOT, 'guide.json'), encoding='utf-8'))['subjects']
    for key, cfg in SUBJECTS.items():
        g = guide[key]
        content = cfg['content']
        # --- 対応のチェック ---
        want = {(ge['name'], it['name']) for ge in g['genres'] for it in ge['items']}
        have = {(ge, name) for ge, items in content.items() for (name, *_rest) in items}
        miss, extra = sorted(want - have), sorted(have - want)
        if miss or extra:
            sys.exit(f'{key}: ノートの過不足 不足={miss} 余分={extra}')
        info = {(ge['name'], it['name']): it for ge in g['genres'] for it in ge['items']}

        wb = openpyxl.Workbook()
        wb.remove(wb.active)
        genres = [ge['name'] for ge in g['genres']]            # 出題数の多い順
        order = list(content.keys())

        # ① 目次
        toc = [
            ('1', '①_目次と活用ガイド', '本ノートの構成・使い方・凡例', '学習の最初に読む'),
        ]
        for i, ge in enumerate(order, start=2):
            n = sum(info[(ge, name)]['n'] for (name, *_r) in content[ge])
            toc.append((str(i), f'{NUMS[i - 1]}_{ge}', f'{len(content[ge])}項目・過去{n}問の論点の要点・公式・数値・引っかけ', '分野ごとに通読し、「関連過去問を見る」で実際の問題を確認'))
        k = len(order) + 2
        toc.append((str(k), f'{NUMS[k - 1]}_直前チェック(引っかけ集)', '全項目の「正誤の引っかけ」を一覧に集約', '試験直前の総確認'))
        toc.append((str(k + 1), f'{NUMS[k]}_出題頻度マップ', '全項目の過去の出題数・優先ランク・学習順位', '学習の優先順位を決める'))
        ws = wb.create_sheet('①_目次と活用ガイド')
        ws['B2'] = cfg['title']
        ws['B3'] = cfg['sub']
        ws['B5'] = '■ 収録タブ一覧と構成'
        ws['B5'].font = Font(bold=True)
        for j, h in enumerate(['No.', 'シート名', '主な収録内容', '活用ポイント'], start=2):
            ws.cell(6, j, h)
        for i, r in enumerate(toc, start=7):
            for j, v in enumerate(r, start=2):
                ws.cell(i, j, v)
        r0 = 7 + len(toc) + 1
        notes = [
            '■ 活用のしかた',
            '・優先ランクは、過去の出題数（直近を重く評価）で付けています。S（最優先）→A（重要）→B（標準）→C（余裕があれば）の順に学習します。',
            '・各項目の「出題ポイント」は、過去問で実際に使われた引っかけを中心にまとめています。',
            '・数値・制度・統計は改正や更新があります。最新の値は白書・官公庁の公表資料で確認してください（出題当時のものが正解として扱われます）。',
            '・過去問は学習ガイド（guide.html）の論点一覧から、論点ごとに演習できます。',
        ]
        for i, t in enumerate(notes):
            ws.cell(r0 + i, 2, t)
        style_sheet(ws, 6, [8, 30, 60, 50], 4)

        # 分野シート
        all_points = []
        for idx, ge in enumerate(order, start=2):
            rows = []
            for (name, kw, body, point) in content[ge]:
                it = info[(ge, name)]
                yrs = sorted(set(it['byYear'].keys()), key=lambda y: g['years'].index(y))
                recent = ' '.join(f"{short_year(y)}×{it['byYear'][y]}" for y in yrs[-6:])
                ex = '／'.join(x['name'] for x in it['issues'][:5])
                perf = f"過去{it['n']}問（優先ランク{it['rank']}・学習順位{it['order']}位）\n直近の出題: {recent}\n論点例: {ex}"
                rows.append((ge, name, kw, body.strip(), point.strip(), perf))
                all_points.append((ge, name, it['rank'], point.strip()))
            rows.sort(key=lambda r: info[(ge, r[1])]['order'])
            add_sheet(wb, f'{NUMS[idx - 1]}_{ge}', f'{cfg["title"]} ／ {ge}',
                      f'{ge}の全{len(rows)}項目（出題の多い順）', HEADER, rows, WIDTHS)

        # 引っかけ集
        rank_order = {'S': 0, 'A': 1, 'B': 2, 'C': 3}
        all_points.sort(key=lambda p: (rank_order[p[2]], p[0], p[1]))
        add_sheet(wb, f'{NUMS[len(order) + 1]}_直前チェック(引っかけ集)', f'{cfg["title"]} ／ 直前チェック',
                  '全項目の「正誤の引っかけ」（優先ランク順）。試験直前に通読する', ['分野', '項目', '優先ランク', '出題ポイント（正誤の引っかけ）'],
                  all_points, [18, 24, 10, 110])

        # 頻度マップ
        fm = []
        for ge in g['genres']:
            for it in sorted(ge['items'], key=lambda x: x['order']):
                yrs = sorted(it['byYear'], key=lambda y: g['years'].index(y))
                fm.append((ge['name'], it['name'], it['rank'], it['order'], it['n'],
                           ' '.join(f"{short_year(y)}×{it['byYear'][y]}" for y in yrs),
                           '／'.join(x['name'] for x in it['issues'][:8])))
        fm.sort(key=lambda r: r[3])
        add_sheet(wb, f'{NUMS[len(order) + 2]}_出題頻度マップ', f'{cfg["title"]} ／ 出題頻度マップ',
                  '全項目の出題数・優先ランク・学習順位（上位ほど優先して学習）', ['分野', '項目', '優先ランク', '学習順位', '出題数', '年度別の出題数', '論点例'],
                  fm, [18, 24, 10, 10, 8, 80, 80])
        wb.save(os.path.join(ROOT, cfg['file']))
        n_items = sum(len(v) for v in content.values())
        print(f"{cfg['file']}: {len(wb.sheetnames)}シート / {n_items}項目 / {os.path.getsize(os.path.join(ROOT, cfg['file'])) // 1024}KB")


if __name__ == '__main__':
    main()
