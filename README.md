# 技術士一次試験 過去問演習

技術士第一次試験（**専門＝衛生工学部門／基礎／適性**）の過去問演習アプリです。静的なWebページで、ブラウザだけで動きます（GitHub Pages で公開）。

- `index.html` … 演習アプリ（過去問演習・本番形式の腕試し・AI予想問題・学習スケジュール・オフライン対応）
- `js/core.js` … 画面に依存しない処理（正答の判定・数式の整形・日付・学習スケジュールの計画づくり・間隔をあけた復習・文章の似かた・AIの応答の読み取り）
- `tests/` … `js/core.js` の自動テスト
- `viewer.html` … 衛生工学のまとめノート（`matome.xlsx` を表示）
- `data/` … 科目ごとの問題データ（`senmon.xlsx` / `kiso.xlsx` / `tekisei.xlsx`）
- `figures/<科目>/<ID>.png` … 問題の原本画像（図・表が必要な問題の確認用）
- `sw.js` / `manifest.webmanifest` / `precache.json` … オフライン対応・ホーム画面への追加
- `tools/` … データの作り直し用スクリプト

## 過去問データの作り直し

元の過去問DB（「問題DB」「問題画像」シートを持つExcel）が更新されたら、次のコマンドで `data/`・`figures/`・`precache.json` を作り直します。

```
python3 tools/build_db.py --senmon 専門.xlsx --kiso 基礎.xlsx --tekisei 適性.xlsx
```

- 正答が空の問題は `tools/official_answers.json`（[日本技術士会の公式正答表](https://www.engineer.or.jp/c_topics/004/004106.html)）から補います。複数正解（「4又は3」など）や、不適切な出題で全員正解の問題も扱います。
- 専門科目は、従来の分類（3ブロック・サブジャンル・細目）と、まとめノートの過去問参照IDを `tools/senmon_legacy.json` から引き継ぎます。
- 作り直したら `python3 tools/stamp_sw.py` を実行してください（`sw.js` の `CACHE_NAME` をファイルの中身から決め直し、端末に保存された古いファイルを入れ替える）。
- 必要なもの: Python 3（openpyxl, pillow, numpy）


## 学習ガイド（guide.html）

過去問DBから論点ごとの出題回数・優先度・「正しい記述」をまとめたページ。データを作り直したら `python3 tools/build_guide.py` で `guide.json` を作り直し、`python3 tools/stamp_sw.py` を実行する。

## 基礎・適性のまとめノート（matome_kiso.xlsx / matome_tekisei.xlsx）

内容は `tools/matome_kiso_content.py`・`tools/matome_tekisei_content.py` に書いてある。`python3 tools/build_guide.py && python3 tools/build_matome.py` でExcelを作り直す（過去問の論点グループとノートの項目が1対1に対応していないとエラーで止まる）。閲覧は `viewer.html?subject=kiso`（または tekisei）。

## 自動テストとコミット前のチェック

```
node --test tests/*.test.js     # js/core.js の自動テスト
python3 tools/stamp_sw.py       # sw.js の CACHE_NAME を、オフライン用ファイルの中身から自動で決める
git config core.hooksPath .githooks   # 一度だけ: コミット前に上の2つを自動で実行する
```

GitHub に送ると `.github/workflows/test.yml` が同じテストと、`CACHE_NAME` が最新かを確かめます。
