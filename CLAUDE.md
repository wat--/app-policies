# tail-studio.com ブログ記事ルール

## サイト概要

- Jekyll製静的サイト、GitHub Pages でホスティング
- ドメイン: tail-studio.com
- AdSense 審査対応のため、コンテンツの独自性・質を重視する

## 記事ファイル

- 場所: `_posts/`
- ファイル名: `YYYY-MM-DD-slug.md`
- レイアウト: `post`

## フロントマター

```yaml
---
layout: post
title: "記事タイトル"
date: YYYY-MM-DD HH:MM:SS +0900
tags: [タグ1, タグ2]
description: 記事の概要（検索結果に表示される）
---
```

## 公開時の注意

- `date` は **push する時刻より前**にする。Jekyll は未来日付の記事を既定で除外し、GitHub Pages は push のときにしかビルドしないので、未来日付のまま push すると記事が出ず、時間が過ぎても自動では現れない（2026-10-31 に発生。日付を直して再 push で解決）。

## アプリ画面のスクリーンショット

- アプリ説明記事には画面を 2〜3 枚入れる。`<div class="shot-row">` に `<figure><img ...><figcaption>` を並べる（CSS は `assets/css/blog.css` の `.shot-row`、横長は `figure.wide`）。
- 画像は `assets/images/blog/<slug>/NN.jpg`（縦 480px 幅 / 横 900px 幅、JPEG q85）。元画像は App Store Connect の公開スクリーンショットを API で取得するのが手早い（2026-11-01 に iOS 11 本へ適用）。
- 画面に個人情報・テスト用の広告バナー（Test mode）が写っていないか目視する。

## 記事スタイル

- **対象読者**: エンジニア（技術手順記事）または一般（アプリ・体験記）
- **目次**: 見出しが4つ以上ある記事には目次をリンク付きで冒頭に置く
- **見出し**: `##` をトップレベルとして使う（`#` はタイトルと重複するため使わない）
- **コードブロック**: 言語を明示する（`powershell`, `bash`, `swift` など）
- **表**: 比較・オプション解説には積極的に使う
- **文体**: 体験記は一人称・です・ます調、技術記事は簡潔に

## タグ一覧（既存）

- `アプリ開発` — iOSアプリ開発・リリース体験
- `iOSアプリ` — App Storeで公開しているiOSアプリの記事
- `Webアプリ` — ブラウザで動くWebアプリ・Webツールの記事
- `生成AI` — LLM・AI関連の技術記事
- `NPU` — NPUを使った推論環境の構築
- `Windows` — Windows環境での手順まとめ

## AdSense 対応上の注意

- note など他プラットフォームに同一内容を投稿しない（重複コンテンツ違反）
- 既存記事を他プラットフォームに転載する場合は canonical タグを設定するか、内容を書き分ける
- 記事は1500字以上を目安に、独自の考察・体験談を含める

## 記事管理の経緯

- App Storeリリース体験記（その1・その2・開発環境編・その後）は総集編1本に統合済み（2026-06-17）
- llama.cpp, InternVL2.5, claude-age-restriction の記事は削除済み（AdSense審査対応）

## 記事の「いいね」機能

- `_layouts/post.html` に実装。counterapi.dev (workspace: `ws-team-1-5136`) を使った全訪問者共有カウント。
- 記事URL とカウンター名（`post-01`, `post-02`, ...）の対応は `_data/like-counters.yml` で管理する。
- **新しい記事を公開するときは、`_data/like-counters.yml` に未使用の `post-NN` を1行追加する。**
  - 例: `"/blog/2026/08/20/new-post/": post-20`
  - `_config.yml` に登録されていない記事はカウンターがなくても壊れず、自動的に localStorage のみのローカル表示にフォールバックする。
- `post-NN` の在庫が尽きたら、[app.counterapi.dev](https://app.counterapi.dev/team/ws-team-1/counters) の workspace で新しい番号の counter をまとめて作成してから `_data/like-counters.yml` に追記する（counterapi.dev には新規カウンター作成 API がなく、ダッシュボードでの手動作成が必須）。
- **workspace は Public Workspace に設定済み。** counterapi.dev はスコープを絞ったトークンを発行できず常に Full Access になり、ブラウザから直接 `Authorization` ヘッダーを送ると CORS でブロックされる（`Access-Control-Allow-Headers` に `Authorization` が含まれていないため）。そのため認証なしでアクセスできる Public Workspace 方式にしている。workspace を Private に戻すといいねボタンが機能しなくなるので注意。
- counterapi.dev の GET エンドポイントは Cloudflare CDN で `max-age=14400`（4時間）キャッシュされる。JS 側は `?cb=<timestamp>` のキャッシュバスターを付けて回避している（`_layouts/post.html` の `apiUrl()` 参照）。
- 注意: この対応で防げるのは **Git のソースコード履歴にトークンが残らないこと** だけ。いいねボタンはブラウザから直接 counterapi.dev の API を叫ぶ実装のため、**公開されているブログの HTML ページ自体には Full Access トークンが平文で表示される**（避けられない）。万一悪用が発覚したらダッシュボードでトークンを失効し、新しいトークンを発行して Secrets を更新する。

## 記事コメント欄

- 自前実装（Disqus は使わない。トラッキングを避けるため）。Cloudflare Workers + D1。コードは `_comments-worker/`（Jekyll の対象外）。
- Worker: `https://tail-studio-comments.waw71068.workers.dev`（`_config.yml` の `comments.endpoint`。空にすると非表示）。D1 は `tail-studio-comments`。
- `_layouts/post.html` がコメント一覧の取得と投稿フォームを持つ。投稿は**承認制**（承認されるまで公開されない）。IP・Cookie は保存しない。
- スパム対策: ハニーポット、表示から3秒未満の投稿を拒否、本文2〜2000字、リンク3つ以上は拒否、承認待ちの上限（記事ごと20件・全体300件）、Origin を tail-studio.com に限定。
- 承認・削除: `https://tail-studio-comments.waw71068.workers.dev/admin#<ADMIN_KEY>`（合言葉は `#` 以降に置く。サーバーには送られない）。ADMIN_KEY は Worker のシークレット（`cd _comments-worker && npx wrangler secret put ADMIN_KEY` で変更）。リポジトリには入れない。
- 変更の反映: `cd _comments-worker && npx wrangler deploy`（要 `npx wrangler login`）。DB スキーマは `schema.sql`。
- 新着通知メール: Worker の `send_email` バインディング（`MAIL`）で、Email Routing の確認済み転送先へ送る。宛先はシークレット `NOTIFY_TO`（公開リポジトリに書かない）、差出人は `comments@tail-studio.com`。10 分に 1 通まで（D1 の `meta.last_notified`）。利用者の入力はメールのヘッダーに入れず、base64 の本文だけに入れる。
- 入力の扱い: SQL はすべてプレースホルダー、画面表示はすべて `textContent`（HTML として解釈させない）。制御文字・双方向制御文字は保存前に除去。リクエストは JSON のみ・16KB まで。管理 API は CORS を返さない。管理画面は CSP 付き。**表示を `innerHTML` に変えたり、Markdown 対応を足したりするときは XSS 対策を必ず見直す。**
