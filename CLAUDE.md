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
- **counterapi.dev はスコープを絞ったトークンを発行できず、常に Full Access（アカウント全体への完全アクセス権限）になる。** リポジトリが public のため、`_config.yml` の `likes.token` は空のままにし、絶対にコミットしない。
- 実際のトークンは GitHub Secrets の `COUNTERAPI_TOKEN` に登録し、`.github/workflows/pages.yml` のビルドステップで `_config.yml` に注入してからデプロイする。この仕組みのため、GitHub Pages のビルド方式は Legacy ではなく GitHub Actions（Settings > Pages > Source: GitHub Actions）である必要がある。
- 注意: この対応で防げるのは **Git のソースコード履歴にトークンが残らないこと** だけ。いいねボタンはブラウザから直接 counterapi.dev の API を叫ぶ実装のため、**公開されているブログの HTML ページ自体には Full Access トークンが平文で表示される**（避けられない）。万一悪用が発覚したらダッシュボードでトークンを失効し、新しいトークンを発行して Secrets を更新する。

## 記事コメント欄

- Disqus を使用。`_config.yml` の `disqus.shortname` を設定すると `_layouts/post.html` にコメント欄が表示される。
- Disqus の無料プランはコメント欄上部に他社広告が表示される（月$12〜の Plus プランで非表示化可能、現状は無料プランのまま運用）。
