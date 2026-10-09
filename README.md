# 技術士一次試験 過去問演習

技術士第一次試験（**専門＝衛生工学部門／基礎／適性**）の過去問演習アプリです。静的なWebページで、ブラウザだけで動きます（GitHub Pages で公開）。

- `index.html` … 演習アプリ（過去問演習・本番形式の腕試し・AI予想問題・オフライン対応）
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
- 作り直したら `sw.js` の `CACHE_NAME` の番号を上げてください（端末に保存された古い画像を入れ替えるため）。
- 必要なもの: Python 3（openpyxl, pillow, numpy）
