---
layout: post
title: "CPU環境で「llama.cpp + InternVL3-1B-Instruct-GGUF」を試すまでの手順まとめ【Windows11】"
date: 2025-06-19 17:23:31 +0900
tags: [AI, 開発]
description: CPUのみの環境でllama.cppとInternVL3-1B-Instruct-GGUFを動かすまでの手順をWindows 11でまとめました。
---

近年、エッジAIなど、軽量なLLM（大規模言語モデル）やマルチモーダル推論の実装が急速に進んでいます。今回は、[ggerganov/llama.cpp](https://github.com/ggerganov/llama.cpp)を使用したCPU対応のモデルを試しましたので手順をまとめました。

具体的には、Microsoftが提供するvcpkgを使った依存ライブラリの導入から、InternVL3-1B-Instruct-GGUFを使って実際に画像に対する質問を行うところまでを、**Windows 11 Pro + Visual Studio 2022環境**で検証しました。

---

## ◆ 検証環境スペック

- **OS**：Windows 11 Pro
- **CPU**：Intel(R) Core(TM) i5-8250U CPU @ 1.60GHz
- **メモリ**：16GB
- **Visual Studio**：Visual Studio 2022（x64 Native Tools Command Prompt使用）

ローエンド寄りのCPU構成ではありますが、 **GPU非搭載の環境でも動作可能か？** という観点から敢えてこの環境で挑戦しています。

同等環境はこちら。

[https://amzn.to/3MLHe0G](https://amzn.to/3MLHe0G)

---

## ◆ 環境準備

環境構築（Visual Studio/CMake/vcpkgの導入）については、ChitakoさんのZenn記事「[Windows 11](https://zenn.dev/chitako/articles/0ad26c5807b18e#1.-%E7%92%B0%E5%A2%83%E6%BA%96%E5%82%99)[で](https://zenn.dev/chitako/articles/0ad26c5807b18e#1.-%E7%92%B0%E5%A2%83%E6%BA%96%E5%82%99)[llama.cpp](https://zenn.dev/chitako/articles/0ad26c5807b18e#1.-%E7%92%B0%E5%A2%83%E6%BA%96%E5%82%99)[を構築する](https://zenn.dev/chitako/articles/0ad26c5807b18e#1.-%E7%92%B0%E5%A2%83%E6%BA%96%E5%82%99)[(CUDA](https://zenn.dev/chitako/articles/0ad26c5807b18e#1.-%E7%92%B0%E5%A2%83%E6%BA%96%E5%82%99)[サポート付き](https://zenn.dev/chitako/articles/0ad26c5807b18e#1.-%E7%92%B0%E5%A2%83%E6%BA%96%E5%82%99)[)](https://zenn.dev/chitako/articles/0ad26c5807b18e#1.-%E7%92%B0%E5%A2%83%E6%BA%96%E5%82%99)」を参考にしました。

## ◆ vcpkg による依存関係の構築

まずは curl のビルドとリンクを簡略化するために、[vcpkg](https://github.com/microsoft/vcpkg) を導入します。

```
pushd <任意の作業ディレクトリ>

git clone https://github.com/microsoft/vcpkg.git
cd vcpkg
.\bootstrap-vcpkg.bat
```

次に、curl[core,ssl]をインストール。

```
.\vcpkg install curl[core,ssl]:x64-windows
```

---

## ◆ llama.cpp のビルド（Visual Studio 2022）

次に、llama.cppのソースをクローンしてビルドを行います。

```
git clone https://github.com/ggerganov/llama.cpp.git
cd llama.cpp
mkdir build && cd build
```

CMakeを以下のように構成します：

```
cmake .. ^
  -G "Visual Studio 17 2022" ^
  -A x64 ^
  -DCMAKE_BUILD_TYPE=Release ^
  -DCMAKE_TOOLCHAIN_FILE="<path>/vcpkg/scripts/buildsystems/vcpkg.cmake"
```

ビルド実行：

```
cmake --build . --config Release
```

正常にビルドが完了すると、build\bin\Release 配下に以下のような実行ファイルが生成されます：

- llama-cli.exe
- llama-mtmd-cli.exe（マルチモーダル対応）

---

## ◆ モデルファイルの取得（InternVL3）

本来は以下のように huggingface-cli でダウンロード可能です：

```
huggingface-cli download ggml-org/InternVL3-1B-Instruct-GGUF --local-dir <path>\llama.cpp\models\InternVL3
```

しかし、筆者の環境では上手くいかなかったため、手動でモデルファイル（.gguf形式）をダウンロードし、以下の構成で配置しました：

```
llama.cpp
└── models
    └── InternVL3
        ├── InternVL3-1B-Instruct-Q8_0.gguf
        └── mmproj-InternVL3-1B-Instruct-Q8_0.gguf
```

---

## ◆ 実行コマンド例

推論実行のためには、画像ファイル（例：input.png）を指定し、以下のコマンドを使用します：

```
cd llama.cpp\build\bin\Release

.\llama-mtmd-cli.exe ^
  -m ..\..\..\models\InternVL3\InternVL3-1B-Instruct-Q8_0.gguf ^
  --mmproj ..\..\..\models\InternVL3\mmproj-InternVL3-1B-Instruct-Q8_0.gguf ^
  --no-mmproj-offload ^
  --threads %NUMBER_OF_PROCESSORS% ^
  --image <path>\input.png ^
  -p "この画像に何が写っていますか？"
```

画像に対する自然言語での問いかけを行い、その答えを得ることができました。筆者の環境では10～20秒程度で応答しました。

---

## ◆ 補足とハマりポイント

- **CMake の構成・実行**：プロキシ環境など、環境によっては、CURL 機能を無効化してビルドしないとエラーになることがあります。その場合は、以下のように構成して実行すると解決できる可能性があります。
「cmake .. -DCMAKE_BUILD_TYPE=Release -DLLAMA_CURL=OFF」
ただし、手動でモデルファイルをダウンロード、配置する必要があります。
- 上記のように構成を見直す場合、「llama.cpp\build」フォルダ内にファイルが残っていると失敗することがあるのでフォルダ内を空にしてから実行ください。

---

## ◆ おわりに

軽量なLLMと画像認識モデルの組み合わせによって、**GPUがなくてもマルチモーダルな質問応答が可能**になってきています。モデルサイズを調整すれば、**よりスペックの低い端末やローカルデバイスでも動かせる可能性**があります。

今後は、NPUを使った推論にもチャレンジしてみたいと考えています。

---

## ◆ 参考リンク

- Windows11でllama.cppを構築する(CUDA）:[https://zenn.dev/chitako/articles/0ad26c5807b18e](https://zenn.dev/chitako/articles/0ad26c5807b18e)
- llama.cpp: [https://github.com/ggerganov/llama.cpp](https://github.com/ggerganov/llama.cpp)
- InternVL3 Model: [https://huggingface.co/ggml-org/InternVL3-1B-Instruct-GGUF](https://huggingface.co/ggml-org/InternVL3-1B-Instruct-GGUF)
- vcpkg: [https://github.com/microsoft/vcpkg](https://github.com/microsoft/vcpkg)
