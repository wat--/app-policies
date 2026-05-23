---
layout: post
title: "NPU環境で「InternVL2.5-1B」を試すまでの手順まとめ【Module-LLM (AX630C)+Windows 11 Pro】"
date: 2025-06-23 16:56:41 +0900
tags: [AI, 開発]
description: M5Stack Module-LLM (AX630C) のNPUでInternVL2.5-1Bを動かしてみた手順まとめです。
---

近年、エッジAIなど、軽量なLLM（大規模言語モデル）やマルチモーダル推論の実装が急速に進んでいます。今回は、M5Stack Module-LLM (AX630C)を使用したNPU対応のモデルを試しましたので手順をまとめました。

具体的には、**中国**深圳に拠点を持つスタートアップ企業であるM5Stackが提供するModule LLMを使ったセットアップから、InternVL2.5-1Bを使って実際に画像に対する質問を行うところまでを、**Module-LLM(AX630C)+Windows 11 Pro環境**で検証しました。

---

## ◆ 検証環境スペック

- **OS**：Windows 11 Pro
- **CPU**：Intel(R) Core(TM) i5-8250U CPU @ 1.60GHz
- **メモリ**：16GB
- **Module-LLM NPU：AX630C**

Windows 11環境はAPI接続用です。推論モデルはAX630Cで動作させます。

---

## ◆ 環境準備

Module LLMはスイッチサイエンスさんで購入しました。1万円しませんでした。
[https://www.switch-science.com/products/10334](https://www.switch-science.com/products/10334)Amazonでは以下が同等のようです。

[https://amzn.to/4kDIYpr](https://amzn.to/4kDIYpr)

その他の環境構築（接続方法等）については、kouさんのnote記事「[llm module](https://note.com/kou519/n/n8dd8b52e4511)[へ](https://note.com/kou519/n/n8dd8b52e4511)[TeraTerm](https://note.com/kou519/n/n8dd8b52e4511)[で接続する方法【](https://note.com/kou519/n/n8dd8b52e4511)[Windows](https://note.com/kou519/n/n8dd8b52e4511)[版】](https://note.com/kou519/n/n8dd8b52e4511)」を参考にしました。

## ◆ Module LLMでのAPIサーバ構築

### AX630C に接続する(Windowsのコマンドプロンプトでabdツールを使って実施)

```
cd <abdツールを展開したフォルダ>
adb shell
```

### AX630C に接続後の作業

```
bash
ifconfig  # AX630CのIPアドレス確認
cd /opt/m5stack/
git clone https://github.com/m5stack/ModuleLLM-OpenAI-Plugin.git
cd ModuleLLM-OpenAI-Plugin
pip install -r requirements.txt
python3 api_server.py
```

この手順でAX630C上にAPIサーバを立ち上げます。

---

## ◆ Windows 側でAPIクライアント実装例

以下は画像をbase64エンコードし、Module-LLMに送信するPythonスクリプトです。[ModuleLLM_OpenAI_API_example](https://github.com/nnn112358/ModuleLLM_OpenAI_API_example)を流用させていただき、
AX630CのIPアドレスでserver_urlを書き換えました。
その他、画像ファイル名とmodelも書き換えています。

```
import requests
import json
import base64
import os

def image_to_base64(image_path):
    with open(image_path, "rb") as f:
        return base64.b64encode(f.read()).decode('utf-8')

def query_vlm(image_path, prompt="この画像に何が見えますか？", model="internvl2.5-1B-ax630c", server_url="http://192.168.1.100:8080"):
    if not os.path.exists(image_path):
        return {"error": f"画像ファイル '{image_path}' が見つかりません"}

    base64_image = image_to_base64(image_path)

    data = {
        "model": model,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{base64_image}"}}
            ]
        }],
        "temperature": 0.2
    }

    response = requests.post(
        f"{server_url}/v1/chat/completions",
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer YOUR_KEY"
        },
        json=data
    )
    return response.json()

if __name__ == "__main__":
    result = query_vlm("test.png", prompt="この画像に何が見えますか？", model="internvl2.5-1B-364-ax630c", server_url="http://192.168.1.100:8000")
    print(json.dumps(result, indent=2, ensure_ascii=False))
```

**実行結果は約10秒で応答が得られ、実用レベルでした。**

## ◆ おわりに

**高価なGPUが無くても、安価なNPUでマルチモーダルな質問応答が可能**になってきています。

今後は、Intel Core UltraのNPUを使った推論にもチャレンジしてみたいと考えています。

---

## ◆ 参考リンク

- [Module LLM](https://www.switch-science.com/products/10334)
- [llm moduleへTeraTermで接続する方法【Windows版】](https://note.com/kou519/n/n8dd8b52e4511)
- [ModuleLLM_OpenAI_API](https://github.com/m5stack/ModuleLLM-OpenAI-Plugin.git)
- [ModuleLLM_OpenAI_API_example](https://github.com/nnn112358/ModuleLLM_OpenAI_API_example)
