# hattatsu-info

発達障害（ASD・ADHD・LD など）の子育て情報を、ネット上のブログ・メディアから
自動で集めて整理するための収集パイプライン。
将来的に「悩む保護者向けの情報サイト」を生成することを目的にしている。

現時点で動くのは **①ブログピックアップ → ②確認 → ③記事取得 → ④加工 → ⑤確認** まで。
（静的サイト生成・公開は次のステップ）

## 全体像

```
   ① npm run discover   Claude の Web検索でブログ・メディア候補を探す（RSS自動検出つき）
        │
   ② npm run sources    候補を確認して 承認/却下（承認したものだけ次に進む）
        │
   ③ npm run fetch      承認済みソースの RSS を巡回 → 本文抽出 → data/articles.db に保存
        │
   ④ npm run enrich     Claude で 要約・要点・タグ・カテゴリ・注意フラグ を付与
        │
   ⑤ npm run show       記事を確認して 承認/却下（人間のレビュー）
        │
   （今後）承認済み記事から静的サイト生成 → GitHub Pages で公開
```

`config/sources.yaml` に手動で RSS を書くこともできる（`enabled: true` で自動承認扱い）。
①②を使わず、いきなり③から始めても良い。

## セットアップ

```bash
cd hattatsu-info
npm install

# Claude API キー（①④で使用）
setx ANTHROPIC_API_KEY "sk-ant-..."   # PowerShell。設定後にターミナルを開き直す
```

Node.js 22 以降が必要（`node:sqlite` を使用）。

## 使い方

### 1. ブログピックアップ（自動）

```bash
npm run discover                          # 候補を約10件探す
npm run discover -- --count 15
npm run discover -- --query "ADHD 中学生 反抗期"   # テーマを絞る
```

Claude の Web検索で日本語のブログ・note・はてなブログ等を探し、各候補について
RSS フィードを自動検出（HTML の `<link rel="alternate">` → `/feed` `/rss` 等の定番パターンの順に試行）して
`候補(candidate)` として登録する。既に登録済みのサイトは除外指示するので重複しにくい。
怪しい民間療法サイト等は「除外推奨」として弾かれる。

手動で候補を足したいときは:

```bash
npm run sources -- add "https://example.com" --name "サイト名"
```

### 2. 確認（ブログ）

```bash
npm run sources                           # 候補一覧（レビュー待ち）
npm run sources -- approve 3              # 承認 → 次の fetch から巡回対象に
npm run sources -- approve 3 --trust high # 信頼度メモも設定
npm run sources -- reject 3
npm run sources -- setrss 3 "https://..." # RSSが自動検出できなかった候補に手動設定してから承認
npm run sources -- approved               # 承認済み一覧
npm run sources -- rejected               # 却下済み一覧
```

### 3. 記事取得

```bash
npm run fetch                      # 承認済みの全ソースを巡回
npm run fetch -- --source foo      # 特定ソース（slug）だけ
npm run fetch -- --limit 5         # 1ソースあたりの取得件数（既定15）
```

- 本文が 200 字未満の記事、既出 URL、本文がほぼ同一の記事は自動スキップ
- 相手サイトへの負荷を考え、記事ごとに約1.2秒待機する

### 4. 加工（要約・分類）

```bash
npm run enrich                     # 未処理を最大20件
npm run enrich -- --limit 50
npm run enrich -- --retry          # 失敗した記事を再試行
```

モデルは既定で `claude-opus-5`。大量に回してコストを抑えたいときは:

```bash
setx HATTATSU_MODEL "claude-sonnet-5"
```

各記事について次を生成する:
要約 / 要点 / タグ / カテゴリ / 対象年齢 / 読者 / **注意フラグ**（根拠の乏しい主張・
断定的な治療効果の宣伝・エビデンスのない民間療法など）/ 有用性スコア / 信頼性所見。

### 5. 確認（記事）

```bash
npm run show                       # 加工済み（レビュー待ち）一覧
npm run show -- new                # 未加工
npm run show -- cautions           # 注意フラグ付きだけ
npm run show -- <id>               # 詳細（要約・要点・本文冒頭）
npm run show -- approve <id>       # 承認 → 将来のサイト生成対象に
npm run show -- reject <id>
npm run show -- approved           # 承認済み一覧
npm run show -- stats              # 件数サマリ
```

## データと著作権の扱い

- `data/articles.db`（SQLite）はローカルのみ。`.gitignore` 済みでコミットしない。
- 抽出した**本文全文はローカル処理のためだけ**に保存する。
- 公開サイトに載せるのは「要約・短い引用・元記事へのリンク・出典表記」に限る想定。

## データベース構造

- `sources` … ブログ・メディア候補と承認状態（`candidate/approved/rejected`、`discovery: auto/manual`）
- `articles` … 取得した記事（本文・出典・状態 `new/enriched/approved/rejected/error`）
- `enrichment` … Claude が付けたメタデータ（`article_id` で 1:1）

## 今後の予定

- [ ] レビューUI（承認/却下/修正を Web 画面で。今は CLI）
- [ ] 承認済み記事からの静的サイト生成（記事フィード＋テーマ別まとめ）
- [ ] テーマ解説の自動生成（承認済み記事を根拠に概説を執筆）
- [ ] GitHub Pages への公開
- [ ] RSS の無いサイト、Instagram 等への対応
