#!/usr/bin/env python3
"""sw.js の CACHE_NAME を、オフライン用に保存するファイルの中身から自動で決める。

ファイルを1つでも変えると名前が変わり、利用者の端末の古い保存分が入れ替わる（手で番号を上げる必要がない）。
  python3 tools/stamp_sw.py          # CACHE_NAME を書き換える
  python3 tools/stamp_sw.py --check  # 書き換えが必要なら失敗する（自動チェック用）
"""
import hashlib, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SW = os.path.join(ROOT, 'sw.js')
LINE = re.compile(r"^const CACHE_NAME = '[^']*';$", re.M)


def cache_name():
    h = hashlib.sha256()
    files = [f for f in json.load(open(os.path.join(ROOT, 'precache.json'), encoding='utf-8')) if f not in ('./',)]
    for f in sorted(set(files + ['precache.json'])):
        path = os.path.join(ROOT, f)
        h.update(f.encode())
        if os.path.exists(path):
            h.update(open(path, 'rb').read())
    # sw.js 自体の変更も反映する（CACHE_NAME の行は除く）
    h.update(LINE.sub('', open(SW, encoding='utf-8').read()).encode())
    return 'quiz-cache-' + h.hexdigest()[:10]


def main():
    src = open(SW, encoding='utf-8').read()
    want = f"const CACHE_NAME = '{cache_name()}';"
    if not LINE.search(src):
        sys.exit('sw.js に CACHE_NAME の行が見つかりません')
    if LINE.search(src).group(0) == want:
        print('CACHE_NAME は最新です:', want)
        return
    if '--check' in sys.argv:
        sys.exit(f'CACHE_NAME が古いです。python3 tools/stamp_sw.py を実行してください（{want}）')
    open(SW, 'w', encoding='utf-8').write(LINE.sub(want, src))
    print('CACHE_NAME を更新しました:', want)


if __name__ == '__main__':
    main()
