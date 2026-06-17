---
layout: post
title: "OpenVINO Model ServerをWindowsのNPUで動かす【Qwen3 + Tool calling対応】"
date: 2026-06-17 12:00:00 +0900
tags: [生成AI, NPU, Windows]
description: OpenVINO Model Server v2026.1をWindows 11のNPU環境で動かし、Qwen3のTool callingを確認するまでの手順まとめです。
---

OpenVINO Model Server（OVMS）v2026.1をWindows 11のNPU環境で動かし、Qwen3のTool callingを使えるようにするまでの手順をまとめます。

## 目次

- [環境](#環境)
- [インストール](#インストール)
- [起動スクリプト](#起動スクリプト)
- [起動確認](#起動確認)
- [オプション解説](#オプション解説)
- [Tool Parser 選択表](#tool-parser-選択表)
- [NPU vs CPU 比較](#npu-vs-cpu-比較)
- [エンドポイント](#エンドポイント)
- [チャットUI](#チャットui)
- [トラブルシューティング](#トラブルシューティング)

---

## 環境

| 項目 | 内容 |
|------|------|
| デバイス | MSI |
| プロセッサ | Intel Core Ultra 9 185H (2.50 GHz) |
| RAM | 32.0 GB |
| OS | Windows 11 Pro 24H2 (Build 26100.8246) |

Intel Core Ultra 185H はNPU（Neural Processing Unit）を内蔵しており、OVMSのNPU推論に対応しています。

---

## インストール

`C:\tools\ovms` にOVMSを配置します。

```powershell
mkdir C:\tools\ovms
cd C:\tools\ovms

# v2026.1 をダウンロード・展開（Python不要版）
Invoke-WebRequest -Uri "https://github.com/openvinotoolkit/model_server/releases/download/v2026.1/ovms_windows_2026.1.0_python_off.zip" -OutFile "ovms_2026.zip"
Expand-Archive -Path ovms_2026.zip -DestinationPath . -Force
```

> **注意:** `curl.exe` が使えない環境では `Invoke-WebRequest` を使用する。

---

## 起動スクリプト

スクリプトは `C:\tools\ovms` に配置する。

### start_ovms_npu.ps1（NPU起動 / Tool calling対応）

```powershell
Write-Host "=== OpenVINO Model Server Starting (NPU) ===" -ForegroundColor Cyan
Write-Host ""
& "$PSScriptRoot\ovms\setupvars.ps1"
Set-Location $PSScriptRoot
& "$PSScriptRoot\ovms\ovms.exe" `
  --source_model "OpenVINO/Qwen3-8B-int4-cw-ov" `
  --model_repository_path "C:\ovms-models" `
  --model_name qwen3 `
  --target_device NPU `
  --task text_generation `
  --rest_port 8000 `
  --cache_dir .ov_cache `
  --max_prompt_len 2000 `
  --tool_parser hermes3
Read-Host "Press Enter to exit"
```

### start_ovms.ps1（CPU起動 / 高負荷・高スループット向け）

```powershell
Write-Host "=== OpenVINO Model Server Starting ===" -ForegroundColor Cyan
Write-Host ""
& "$PSScriptRoot\ovms\setupvars.ps1"
& "$PSScriptRoot\ovms\ovms.exe" `
  --source_model "OpenVINO/Qwen3-8B-int4-cw-ov" `
  --model_repository_path "C:\ovms-models" `
  --model_name qwen3 `
  --target_device CPU `
  --task text_generation `
  --pipeline_type LM_CB `
  --rest_port 8000 `
  --cache_dir .ov_cache `
  --enable_prefix_caching true `
  --tool_parser hermes3
Read-Host "Press Enter to exit"
```

---

## 起動確認

サーバー起動後、ログに以下が出れば正常。

**NPU（Legacy）の場合：**

```
Initializing Language Model Legacy servable
ServableManagerModule started
```

**CPU（LM_CB）の場合：**

```
Initializing Language Model Continuous Batching servable
ServableManagerModule started
```

---

## オプション解説

| オプション | 説明 |
|-----------|------|
| `--source_model` | HuggingFace上のモデルID。初回のみダウンロード |
| `--model_repository_path` | モデルの保存先ディレクトリ |
| `--model_name` | APIで使用するモデル名（`model` パラメータに指定する値） |
| `--target_device` | 推論デバイス（`NPU` / `CPU` / `GPU`） |
| `--task` | `text_generation` を指定 |
| `--pipeline_type` | `LM_CB`（Continuous Batching）/ 省略でLegacy |
| `--rest_port` | HTTPポート番号 |
| `--cache_dir` | モデルコンパイルキャッシュの保存先 |
| `--max_prompt_len` | 最大プロンプト長（Legacyパイプラインのみ有効） |
| `--enable_prefix_caching` | プレフィックスキャッシュ有効化（LM_CBのみ） |
| `--tool_parser` | Tool callingのフォーマットパーサー |

---

## Tool Parser 選択表

| `--tool_parser` 値 | 対応モデル |
|-------------------|-----------|
| `hermes3` | Qwen3, Qwen2.5, Hermes-3 |
| `llama3_json` | Llama 3.1 / 3.2 / 3.3 |
| `internlm` | InternLM 2.5 |
| `gptoss` | openai/gpt-oss-20b |

---

## NPU vs CPU 比較

| | NPU（Legacy） | CPU（LM_CB） |
|--|--------------|-------------|
| 推論速度 | 速い | 遅い |
| Tool calling | ✅ 動作確認済み（2026.1） | ◯ |
| `--pipeline_type LM_CB` | ✗ 非対応（PagedAttentionエラー） | ◯ |
| `--max_prompt_len` | ◯ | ✗ 非対応 |
| `--enable_prefix_caching` | ✗ | ◯ |

**推奨:** `start_ovms_npu.ps1`（NPU + Legacyパイプライン）を使用する。Tool callingの動作を確認済み。CPUのLM_CBはNPUより低速なため、現時点ではNPUを優先する。

---

## エンドポイント

| エンドポイント | 用途 |
|-------------|------|
| `http://localhost:8000/v3/chat/completions` | チャット（OpenAI互換） |
| `http://localhost:8000/v3/models/qwen3` | 接続確認 |

---

## チャットUI

[chat.html](/assets/chat.html) をブラウザで開く。

**UIの主な機能：**

- **Agent Mode** — Tool callingを有効化（デフォルトON）
- **組み込みツール** — `get_current_time`（現在時刻）、`calculate`（計算）
- **カスタムツール追加** — UIから任意のツールを追加可能
- **ツール使用履歴** — 回答欄にどのツールを使ったか表示
- **ステップカード** — ツール実行の入力・出力を折りたたみ表示

---

## トラブルシューティング

| エラー | 原因 | 対処 |
|--------|------|------|
| `Option 'MAX_PROMPT_LEN' is not supported` | LM_CBで`--max_prompt_len`を指定 | `--max_prompt_len`を削除 |
| `pipeline_type: CB is not allowed` | 値が間違い | `LM_CB`に修正 |
| `PagedAttentionExtension ... unsupported opset` | NPUはLM_CB非対応 | `--pipeline_type LM_CB`を削除しLegacyで起動 |
| ツールが呼ばれない | バージョンが2025系 | 2026.1にアップデート |
| `curl.exe`が見つからない | PATHに未登録 | `Invoke-WebRequest`を使用 |

---

## 参考

OVMSのWindows NPU環境でのセットアップについて、先行して詳しくまとめてくださっている記事を参考にさせていただきました。

- [OpenVINOのModel ServerをWindowsで動作させてみる - uepon日々の備忘録](https://uepon.hatenadiary.com/entry/2026/03/30/160249)
