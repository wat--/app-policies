---
layout: post
title: "iOS 27 の Foundation Models で Private Cloud Compute を使おうとして分かったこと【entitlement と Small Business Program の壁】"
date: 2026-10-31 09:00:00 +0900
tags: [アプリ開発, iOSアプリ, 生成AI]
description: iOS 27 の Foundation Models フレームワークで Apple の Private Cloud Compute（PCC）上のモデルを呼び出そうとしたら、実機でアプリが落ちました。原因は管理対象 entitlement の不足で、その申請には App Store Small Business Program への加入、さらに有料アプリ契約の承諾と法人情報のコンプライアンス審査が必要でした。無料アプリしか出していない個人開発者がつまずいた点を順に記録します。
---

iOS 27 の Foundation Models フレームワークには、端末内モデルに加えて Apple の Private Cloud Compute（PCC）上で動く大きなモデルを呼び出す API が入りました。App Store Small Business Program に加入していて累計初回ダウンロードが 200 万未満なら、クラウド API の費用なしで使えるとされています。

個人開発の無料アプリ「[花サーチ](https://apps.apple.com/jp/app/%E8%8A%B1%E3%82%B5%E3%83%BC%E3%83%81/id6802036544)」にこれを組み込もうとして、コードの外側で何段階もつまずきました。この記事はその記録です。同じ順番で壁に当たる人は多いと思うので、先に全体像を書いておきます。

## 目次

- [全体像: PCC を使うまでの 6 段階](#全体像-pcc-を使うまでの-6-段階)
- [実機で落ちた: Missing entitlement](#実機で落ちた-missing-entitlement)
- [クラッシュログを Mac から取る](#クラッシュログを-mac-から取る)
- [entitlement の申請には Small Business Program が要る](#entitlement-の申請には-small-business-program-が要る)
- [Small Business Program には有料アプリ契約が要る](#small-business-program-には有料アプリ契約が要る)
- [有料アプリ契約の前に出てきた 3 つの保留](#有料アプリ契約の前に出てきた-3-つの保留)
- [個人開発者が用意しておくもの](#個人開発者が用意しておくもの)
- [アプリ側でやったこと](#アプリ側でやったこと)
- [現在地](#現在地)

---

## 全体像: PCC を使うまでの 6 段階

コードを書く前に、アカウント側で次の手順を済ませる必要がありました。

| 段階 | 内容 | 無料アプリだけの開発者でも必要か |
|---|---|---|
| 1 | Apple Developer Program License Agreement の最新版を Account Holder が承諾 | 必要（放置すると App Store Connect が使えなくなる） |
| 2 | App Store Connect の法人情報を正しい形式に直す | 必要 |
| 3 | 法人名を英字で示す書類を提出（コンプライアンス審査） | 求められた場合は必要 |
| 4 | 有料アプリ契約（Paid Applications Agreement）を承諾し、銀行口座と税務情報を登録 | 必要（Small Business Program の加入条件） |
| 5 | App Store Small Business Program に加入申請（承認まで数日） | 必要（PCC の申請条件） |
| 6 | PCC entitlement の申請フォームを送信 | 必要 |

「無料アプリしか出していないので有料アプリ契約は関係ない」と思っていると、4 で止まります。PCC の無料枠は Small Business Program の特典という建て付けなので、まず「売上が少ない事業者」として登録される必要がある、という構造です。

## 実機で落ちた: Missing entitlement

実装自体は簡単です。`PrivateCloudComputeLanguageModel()` を作り、`isAvailable` が true なら `LanguageModelSession(model:instructions:)` に渡すだけで、端末内モデルと同じ `respond` / `streamResponse` が使えます。`quotaUsage` で 1 日の利用上限の残りも読めます。

ところが iOS 27.2 の実機で質問を送った瞬間にアプリが落ちました。コンソールに出ていたのはこれです。

```
FoundationModels/ErrorConversion.swift:162: Fatal error:
Missing entitlement: com.apple.developer.private-cloud-compute

To develop with PCC you must meet certain eligibility requirements.
To learn more and request access to the managed entitlement, sign into
your Developer account and complete the entitlement request form.
```

ポイントは 3 つあります。

- `isAvailable` も `availability` も `quotaUsage` も、entitlement が無くても正常な値を返します。事前に検出する API はありません。
- 失敗は `throw` ではなく `fatalError` です。`catch` で拾えません。
- macOS 27 の Mac 上で同じコードを `swiftc` のスクリプトとして動かすと、こちらは落ちずに `ModelManagerError 1046` を含むエラーが返ってきます。Mac で動作確認が通っても、iOS 実機では落ちる、という嫌な差があります。

entitlement は `.entitlements` に書けば済むものではなく、Apple に申請して付与される「管理対象 entitlement」です。付与されるまでは、PCC を選ぶ UI を出さないようにコード側で塞ぐしかありません。

## クラッシュログを Mac から取る

Xcode の Organizer を開かなくても、`devicectl` だけで実機のクラッシュログを取れます。

```bash
# クラッシュログの一覧
xcrun devicectl device info files --device <UDID> --domain-type systemCrashLogs

# 1 件取り出す
xcrun devicectl device copy from --device <UDID> --domain-type systemCrashLogs \
  --source MyApp-2026-10-31-034608.ips --destination /tmp/crash.ips
```

ただし `.ips` には「FoundationModels 内の `_assertionFailure`」としか残らず、Fatal error の本文は入っていませんでした。本文を読むには、アプリをコンソール付きで起動して再現してもらうのが確実です。

```bash
xcrun devicectl device process launch --console --terminate-existing \
  --device <UDID> com.example.MyApp
```

標準エラーがそのまま流れてくるので、`Fatal error:` の行が読めます。今回はこれで原因が確定しました。

## entitlement の申請には Small Business Program が要る

Fatal error のメッセージにある申請フォームは https://developer.apple.com/contact/request/private-cloud-compute/ です。Apple Developer にサインインして開いたところ、次の表示で止まりました。

> Access Unavailable — Your account is not currently enrolled in the App Store Small Business Program. To become eligible for PCC access, enroll in the App Store Small Business Program.

フォームの入力項目を見る前に弾かれます。Small Business Program のページにも、PCC は「加入していて累計初回ダウンロード 200 万未満の開発者」が対象と書かれています。

## Small Business Program には有料アプリ契約が要る

Small Business Program の加入ページ（/app-store/small-business-program/enroll/）はシンプルで、Account Holder であることと、「最新の有料アプリ契約（Schedule 2）を App Store Connect で承諾済みか」の二択を聞かれるだけです。

有料アプリ契約そのものに費用はありません。手数料は有料アプリやアプリ内課金の売上にかかるもので、無料アプリだけなら何も発生しません。ただし承諾には銀行口座と税務情報の登録が必要です。無料アプリしか出していないと、ここで初めて口座や税務フォームを用意することになります。

## 有料アプリ契約の前に出てきた 3 つの保留

App Store Connect の「ビジネス」画面で有料アプリ契約を進めようとしたら、その手前で 3 つの保留が連鎖して出てきました。

### 1. Program License Agreement の更新

「本プログラムの使用許諾契約が更新されました」というバナーが出ていて、Account Holder が承諾するまで有料アプリ契約の行が「新規」のまま動きません。承諾には期限があり（今回は約 2 週間後）、過ぎると App Store Connect や証明書の利用が止まります。PCC と無関係に、放置してはいけない項目でした。

### 2. 法人情報の「更新が必要」= 郵便番号のハイフン

契約の表の上に「有料アプリ契約に署名する前に法人情報を更新する必要があります」と出ますが、編集ダイアログを開いても全項目が埋まっていて、何を直せばいいのか分かりません。そのまま保存ボタンを押して初めて「郵便番号が無効です」と赤く出ました。

原因は、郵便番号が `1000001` のようにハイフン無しで登録されていたことです。`100-0001` の形式に直して保存すると通りました。過去のどこかの時点で登録した値が、いまの検証ルールに合わなくなっていたようです。エラーは保存時にしか出ないので、「とりあえず保存を押す」のが正解でした。

### 3. コンプライアンス審査: 法人名を英字で示す書類

法人情報を保存した直後、無料アプリ契約のステータスが「ユーザ情報を保留中」に変わり、「英字で法人名を示す書類を提出してください」というコンプライアンス審査のダイアログが開くようになりました。提出しないと App Store からコンテンツが削除されることがある、という文言付きです。

ビジネス一覧には以前から「1 アクション保留中」と出ていたので、審査自体は前からあり、法人情報の修正をきっかけに前面に出てきたのだと思います。フォームの項目は次の 3 つです。

- 書類ファイル（7MB 以下）
- 企業ウェブサイト（任意）
- 企業系列（任意）

個人事業主の屋号で登録している場合、「法人名を英字で示す書類」が意外と手元にありません。候補として考えているのは、屋号を英字で書いた開業届の控え、Apple から届く D-U-N-S 番号の通知メール（英字の事業名が載っている）、屋号付き口座の明細などです。どれが受理されたかは追記します。

## 個人開発者が用意しておくもの

今回の流れで実際に必要になった、または聞かれた情報です。先に揃えておくと一気に進められます。

| 項目 | 補足 |
|---|---|
| Account Holder のパスキーまたはパスワードと 2 ファクタ認証 | Apple Developer と App Store Connect の両方で求められる |
| 売上受取用の銀行口座 | 金融機関名・支店名・種別・口座番号・名義（カナ）。無料アプリでも有料アプリ契約には必須 |
| 日本の税務情報 | 消費税の課税事業者か免税事業者か。適格請求書発行事業者の登録番号があれば番号 |
| 米国税務フォーム | 個人事業主なら W-8BEN、法人なら W-8BEN-E。日本の納税者番号の記載は任意 |
| 法人名を英字で示す書類 | コンプライアンス審査で求められた場合に提出 |
| D-U-N-S 番号 | 組織として登録している場合は取得済みのはず。法人情報の確認に使う |
| 他の Apple Developer Program アカウントの有無 | Small Business Program の申請で Associated Developer Accounts として申告 |

注意点として、口座名義が屋号ではなく個人名の場合、法人名との不一致が警告される可能性があります。支払いが発生しない無料アプリなら実害はありませんが、覚悟しておくと慌てません。

## アプリ側でやったこと

entitlement が付与されるまで PCC を使わせないために、コードには定数を 1 つ置きました。

```swift
enum AIFeatureSettings {
    /// PCC の管理対象 entitlement が付与されたら true にする。
    /// 無いまま PrivateCloudComputeLanguageModel に質問を送ると fatalError で落ちる。
    static let hasPrivateCloudComputeEntitlement = false
}
```

この定数が false の間は、設定画面に「Apple のプライベートクラウドを使う」のトグルを出さず、セッション生成時も `SystemLanguageModel.default` だけを使います。entitlement が付いたら `.entitlements` にキーを足して定数を true に戻せば、UI が現れる設計です。

「AIに質問」自体は端末内モデルで動くので、PCC が無くても機能としては成立しています。写真を添付できるかは `model.capabilities.contains(.vision)` で判定し、対応していないモデルでは候補名と図鑑の情報だけで答えるようにしました。

## 現在地

この記事を書いている時点で、Program License Agreement の承諾と法人情報の修正は済み、コンプライアンス審査の書類提出と有料アプリ契約の承諾、Small Business Program の加入申請が残っています。PCC の申請フォームはその先です。

一連の流れは、API のドキュメントを読んでいるだけでは見えません。「PCC を試す」と決めたら、コードより先にアカウントの状態を App Store Connect の「ビジネス」画面で確認しておくことをおすすめします。進展があればこの記事に追記します。
