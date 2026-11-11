#!/usr/bin/env python3
"""guide.json（過去問から取り出した「正しい記述」「誤りの記述」）から、勉強用の動画（MP4）を作る。

  python3 tools/build_videos.py            # videos/*.mp4 と videos/videos.json を作る
  python3 tools/build_videos.py --only ox_senmon_1   # 1本だけ作り直す

動画の種類
  ox_*    … ○×一問一答（記述を見て○か×かを考える → 答えと出典）
  rank_*  … 頻出論点ランキング（出題回数の多い論点と、そこで正しいとされた記述）
  trap_*  … ひっかけ注意集（過去に「誤り」とされた記述と、同じ論点の正しい記述）
音声はなく、文字と時間で進む（音を出せない場所でも見られる）。必要なもの: Python 3（pillow）、ffmpeg
"""
import json, os, random, shutil, subprocess, sys, tempfile
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'videos')
W, H = 1280, 720
FONT_PATHS = ['/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf', '/usr/share/fonts/truetype/fonts-japanese-gothic.ttf',
              '/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc', 'C:/Windows/Fonts/meiryo.ttc']
FONT = next((p for p in FONT_PATHS if os.path.exists(p)), None)
if not FONT:
    sys.exit('日本語のフォントが見つかりません（IPAゴシックなど）')

BG, PANEL, TEXT, MUTED = (15, 23, 42), (30, 41, 59), (241, 245, 249), (148, 163, 184)
ACCENT, OKC, NGC, WARN = (168, 85, 247), (34, 197, 94), (239, 68, 68), (234, 179, 8)
THINK_SEC, ANSWER_SEC = 6, 4      # ○×: 考える時間・答えを見る時間（秒）

_fonts = {}


def font(size):
    if size not in _fonts:
        _fonts[size] = ImageFont.truetype(FONT, size)
    return _fonts[size]


def wrap(text, size, width):
    """日本語の文を、幅に収まるように折り返す（句読点が行頭に来ないようにする）"""
    f = font(size)
    lines, cur = [], ''
    for ch in text:
        if ch == '\n':
            lines.append(cur); cur = ''; continue
        if f.getlength(cur + ch) > width and cur:
            if ch in '、。，．）」』,.)':
                cur += ch; lines.append(cur); cur = ''; continue
            lines.append(cur); cur = ch
        else:
            cur += ch
    if cur:
        lines.append(cur)
    return lines


def fit_text(text, width, height, sizes=(40, 36, 32, 29, 26, 23)):
    for s in sizes:
        lines = wrap(text, s, width)
        if len(lines) * s * 1.55 <= height:
            return s, lines
    s = sizes[-1]
    return s, wrap(text, s, width)


def base(header, sub=''):
    im = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, W, 64], fill=PANEL)
    d.text((32, 16), header, font=font(28), fill=TEXT, stroke_width=1, stroke_fill=TEXT)
    if sub:
        d.text((W - 32 - font(22).getlength(sub), 21), sub, font=font(22), fill=MUTED)
    return im, d


def draw_lines(d, lines, size, x, y, fill=TEXT, bold=False):
    for ln in lines:
        d.text((x, y), ln, font=font(size), fill=fill, stroke_width=1 if bold else 0, stroke_fill=fill)
        y += int(size * 1.55)
    return y


def footer(d, text):
    d.text((32, H - 40), text, font=font(20), fill=MUTED)


class Video:
    def __init__(self, vid, title, subtitle):
        self.vid, self.title, self.subtitle = vid, title, subtitle
        self.frames = []   # (画像, 秒)
        self.tmp = tempfile.mkdtemp()

    def add(self, im, sec):
        path = os.path.join(self.tmp, f'{len(self.frames):05d}.png')
        im.save(path)
        self.frames.append((path, sec))

    def duration(self):
        return sum(s for _, s in self.frames)

    def render(self):
        lst = os.path.join(self.tmp, 'list.txt')
        with open(lst, 'w', encoding='utf-8') as f:
            for p, s in self.frames:
                f.write(f"file '{p}'\nduration {s}\n")
            f.write(f"file '{self.frames[-1][0]}'\n")   # 最後の画像の表示時間を有効にするため、もう一度書く
        out = os.path.join(OUT, self.vid + '.mp4')
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', lst,
                        '-vf', 'fps=10,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '30',
                        '-tune', 'stillimage', '-movflags', '+faststart', out], check=True)
        shutil.rmtree(self.tmp, ignore_errors=True)
        return out


def title_card(v, lines, note):
    im, d = base('技術士第一次試験 過去問ダイジェスト', '過去問演習アプリ')
    y = 210
    for i, t in enumerate(lines):
        s = 54 if i == 0 else 34
        d.text(((W - font(s).getlength(t)) / 2, y), t, font=font(s), fill=TEXT if i == 0 else ACCENT, stroke_width=1 if i == 0 else 0, stroke_fill=TEXT)
        y += int(s * 1.8)
    for ln in wrap(note, 24, W - 240):
        d.text(((W - font(24).getlength(ln)) / 2, y + 30), ln, font=font(24), fill=MUTED)
        y += 38
    v.add(im, 4)


def end_card(v, text):
    im, d = base('おつかれさまでした', v.title)
    y = 260
    for ln in wrap(text, 32, W - 240):
        d.text(((W - font(32).getlength(ln)) / 2, y), ln, font=font(32), fill=TEXT)
        y += 52
    footer(d, '記述は過去問の出題時点のものです。法改正・最新の数値は、まとめノートの「最新動向」も確認してください。')
    v.add(im, 4)


def src(st):
    return f"出典: {st['y']} {st['q']}"


# ---------- ○×一問一答 ----------
def ox_video(vid, subj, genres, label, seed, n=24):
    rng = random.Random(seed)
    issues = [(it['name'], iss) for g in genres for it in g['items'] for iss in it['issues'] if iss['ok'] or iss['ng']]
    issues.sort(key=lambda x: (-x[1]['n'], x[1]['name']))
    picks, used = [], set()
    # 出題の多い論点から、×と○を交互に1つずつ取る
    for rnd in range(4):
        for topic, iss in issues:
            pool = (iss['ng'] if (len(picks) % 2 == 0) else iss['ok']) or iss['ok'] or iss['ng']
            cand = [s for s in pool if s['t'] not in used]
            if not cand:
                continue
            s = cand[rnd % len(cand)] if rnd < len(cand) else cand[0]
            used.add(s['t'])
            picks.append((topic, iss['name'], s, s in iss['ok']))
            if len(picks) >= n:
                break
        if len(picks) >= n:
            break
    rng.shuffle(picks)
    v = Video(vid, f'○×一問一答 {label}', f'{subj["label"]}科目')
    title_card(v, [f'○×一問一答', f'{subj["label"]}科目　{label}', f'全{len(picks)}問'],
               f'過去問で「正しい」「誤り」とされた記述です。{THINK_SEC}秒で○か×かを考えてから、答えを確認しましょう。')
    for i, (topic, issue, st, ok) in enumerate(picks, 1):
        hdr = f'○×一問一答　{subj["label"]}：{label}'
        size, lines = fit_text(st['t'], W - 160, 360)
        for k in range(THINK_SEC):   # 考える時間（残り秒数のバーを1秒ごとに減らす）
            im, d = base(hdr, f'第{i}問 / {len(picks)}')
            d.text((80, 96), f'論点: {topic}（{issue}）', font=font(24), fill=ACCENT)
            draw_lines(d, lines, size, 80, 150)
            d.text((80, 560), 'この記述は　○　か　×　か？', font=font(36), fill=WARN, stroke_width=1, stroke_fill=WARN)
            left = THINK_SEC - k
            d.rounded_rectangle([80, 632, W - 80, 648], 8, fill=PANEL)
            d.rounded_rectangle([80, 632, 80 + (W - 160) * left / THINK_SEC, 648], 8, fill=WARN)
            d.text((W - 80 - font(26).getlength(f'{left}'), 588), f'{left}', font=font(26), fill=WARN)
            v.add(im, 1)
        im, d = base(hdr, f'第{i}問 / {len(picks)}')
        mark, col, word = ('○', OKC, '正しい記述') if ok else ('×', NGC, '誤りの記述')
        d.text((80, 84), mark, font=font(110), fill=col, stroke_width=3, stroke_fill=col)
        d.text((220, 120), word, font=font(40), fill=col, stroke_width=1, stroke_fill=col)
        d.text((220, 172), f'{src(st)}（この問で{"正しい選択肢" if ok else "誤りの選択肢"}）', font=font(22), fill=MUTED)
        draw_lines(d, lines, size, 80, 240, fill=TEXT if ok else (254, 202, 202))
        footer(d, f'論点: {topic}（{issue}）')
        v.add(im, ANSWER_SEC)
    end_card(v, '×だった記述は、どこが誤りかを、アプリの過去問演習やまとめノートで確かめておきましょう。')
    return v, len(picks)


# ---------- 頻出論点ランキング ----------
def rank_video(vid, subj, top=10):
    items = [(g['name'], it) for g in subj['genres'] for it in g['items']]
    items.sort(key=lambda x: -x[1]['score'])
    items = items[:top]
    v = Video(vid, f'頻出論点ランキング TOP{top}', f'{subj["label"]}科目')
    title_card(v, ['頻出論点ランキング', f'{subj["label"]}科目　TOP{top}', f'過去{len(subj["years"])}回分の出題から'],
               '最近よく出る論点ほど上位です（出題回数と、直近の年度ほど重く数えています）。それぞれ、過去問で正しいとされた記述を2つずつ紹介します。')
    years = subj['years']
    for r, (gname, it) in sorted(list(enumerate(items, 1)), key=lambda x: -x[0]):
        im, d = base(f'頻出論点ランキング　{subj["label"]}科目', gname)
        d.text((80, 110), f'第{r}位', font=font(44), fill=WARN, stroke_width=1, stroke_fill=WARN)
        size, lines = fit_text(it['name'], W - 160, 140, sizes=(56, 48, 42, 36))
        draw_lines(d, lines, size, 80, 180, bold=True)
        recent = [y for y in years[-5:] if it['byYear'].get(y)]
        d.text((80, 360), f'出題 {it["n"]}問（過去{len(years)}回）', font=font(32), fill=TEXT)
        d.text((80, 410), '直近5回で出た年度: ' + ('、'.join(y.replace('年度', '') for y in recent) or 'なし'), font=font(26), fill=MUTED)
        # 年度ごとの出題数の棒
        x0, bw = 80, (W - 160) / len(years)
        mx = max(it['byYear'].values()) or 1
        for i, y in enumerate(years):
            c = it['byYear'].get(y, 0)
            h = 120 * c / mx
            d.rectangle([x0 + i * bw + 4, 600 - h, x0 + (i + 1) * bw - 4, 600], fill=ACCENT if c else PANEL)
        d.text((80, 610), years[0].replace('年度', ''), font=font(18), fill=MUTED)
        d.text((W - 80 - font(18).getlength(years[-1].replace('年度', '')), 610), years[-1].replace('年度', ''), font=font(18), fill=MUTED)
        v.add(im, 5)
        oks = [s for iss in sorted(it['issues'], key=lambda x: -x['n']) for s in iss['ok']][:2]
        for s in oks:
            im, d = base(f'第{r}位　{it["name"]}', '正しいとされた記述')
            d.text((80, 100), '○ 覚えておきたい記述', font=font(30), fill=OKC, stroke_width=1, stroke_fill=OKC)
            size, lines = fit_text(s['t'], W - 160, 420)
            draw_lines(d, lines, size, 80, 170)
            footer(d, src(s))
            v.add(im, 7)
    end_card(v, '上位の論点から順に、アプリの「学習ガイド」と過去問演習で仕上げましょう。')
    return v, len(items)


# ---------- ひっかけ注意集 ----------
def trap_video(vid, subj, n=15):
    pairs = []
    issues = [(it['name'], iss) for g in subj['genres'] for it in g['items'] for iss in it['issues'] if iss['ng']]
    issues.sort(key=lambda x: (-x[1]['n'], x[1]['name']))
    for topic, iss in issues:
        pairs.append((topic, iss, iss['ng'][0], iss['ok'][0] if iss['ok'] else None))
        if len(pairs) >= n:
            break
    v = Video(vid, 'ひっかけ注意集', f'{subj["label"]}科目')
    title_card(v, ['ひっかけ注意集', f'{subj["label"]}科目', f'{len(pairs)}論点'],
               'よく出る論点で、過去に「誤り」とされた記述です。どこが誤りかを考えながら、同じ論点の正しい記述と見比べましょう。')
    for i, (topic, iss, ng, ok) in enumerate(pairs, 1):
        hdr = f'ひっかけ注意集　{subj["label"]}科目'
        im, d = base(hdr, f'{i} / {len(pairs)}　論点: {topic}')
        d.text((80, 92), '× 誤りとされた記述（どこが誤り？）', font=font(30), fill=NGC, stroke_width=1, stroke_fill=NGC)
        size, lines = fit_text(ng['t'], W - 160, 230)
        y = draw_lines(d, lines, size, 80, 145, fill=(254, 202, 202))
        footer(d, src(ng))
        v.add(im, 7)
        if ok:
            im2, d2 = base(hdr, f'{i} / {len(pairs)}　論点: {topic}')
            d2.text((80, 92), '× 誤りとされた記述', font=font(24), fill=NGC)
            s1, l1 = fit_text(ng['t'], W - 160, 200, sizes=(28, 25, 22))
            y = draw_lines(d2, l1, s1, 80, 130, fill=(254, 202, 202))
            d2.line([80, y + 10, W - 80, y + 10], fill=PANEL, width=2)
            d2.text((80, y + 26), '○ 同じ論点で正しいとされた記述', font=font(24), fill=OKC)
            s2, l2 = fit_text(ok['t'], W - 160, H - (y + 70) - 60, sizes=(28, 25, 22))
            draw_lines(d2, l2, s2, 80, y + 64)
            footer(d2, f'×: {src(ng)}　○: {src(ok)}')
            v.add(im2, 7)
    end_card(v, '誤りの記述は「数値」「主語のすり替え」「必ず・すべて」などの言い切りに注意。間違えた論点は、過去問演習で解き直しましょう。')
    return v, len(pairs)


def plan(g):
    S = g['subjects']
    jobs = []
    for key, subj in S.items():
        gs = subj['genres']
        cnt = lambda gg: sum(len(i['ok']) + len(i['ng']) for it in gg['items'] for i in it['issues'])
        if key == 'tekisei':
            half = (len(gs) + 1) // 2
            groups = [gs[:half], gs[half:]]
        else:
            rich = [x for x in gs if cnt(x) >= 40]
            poor = [x for x in gs if cnt(x) < 40]
            groups = [[x] for x in rich] + ([poor] if poor and sum(cnt(x) for x in poor) >= 20 else [])
        for i, grp in enumerate(groups, 1):
            label = '・'.join(x['name'] for x in grp)
            jobs.append(('ox', f'ox_{key}_{i}', key, grp, label))
        jobs.append(('rank', f'rank_{key}', key, None, None))
        jobs.append(('trap', f'trap_{key}', key, None, None))
    return jobs


def main():
    g = json.load(open(os.path.join(ROOT, 'guide.json'), encoding='utf-8'))
    os.makedirs(OUT, exist_ok=True)
    only = sys.argv[sys.argv.index('--only') + 1] if '--only' in sys.argv else None
    man_path = os.path.join(OUT, 'videos.json')
    manifest = {m['id']: m for m in json.load(open(man_path, encoding='utf-8'))} if os.path.exists(man_path) else {}
    for kind, vid, key, grp, label in plan(g):
        if only and vid != only:
            continue
        subj = g['subjects'][key]
        if kind == 'ox':
            v, n = ox_video(vid, subj, grp, label, seed=vid)
            desc = f'{n}問。記述を見て{THINK_SEC}秒で○×を考え、答えと出典を確認'
        elif kind == 'rank':
            v, n = rank_video(vid, subj)
            desc = '出題の多い論点トップ10と、そこで正しいとされた記述'
        else:
            v, n = trap_video(vid, subj)
            desc = f'{n}論点。誤りとされた記述と、同じ論点の正しい記述を見比べる'
        out = v.render()
        manifest[vid] = {'id': vid, 'kind': kind, 'subject': key, 'title': v.title, 'label': label or '', 'desc': desc,
                         'sec': int(v.duration()), 'file': f'videos/{vid}.mp4', 'size': os.path.getsize(out)}
        print(f'{vid}: {int(v.duration())}秒 {os.path.getsize(out) // 1024}KB')
    order = {k: i for i, k in enumerate(['senmon', 'kiso', 'tekisei'])}
    kinds = {'rank': 0, 'ox': 1, 'trap': 2}
    items = sorted(manifest.values(), key=lambda m: (order[m['subject']], kinds[m['kind']], m['id']))
    json.dump(items, open(man_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
