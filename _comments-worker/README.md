# コメント用 Worker

tail-studio.com の記事コメント。Cloudflare Workers + D1。詳細は ../CLAUDE.md の「記事コメント欄」。

- デプロイ: `npx wrangler deploy`
- スキーマ適用: `npx wrangler d1 execute tail-studio-comments --remote --file=schema.sql`
- 合言葉の変更: `npx wrangler secret put ADMIN_KEY`
- 管理画面: `<Worker の URL>/admin#<ADMIN_KEY>`
