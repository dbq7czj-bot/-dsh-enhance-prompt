# dsh-enhance-prompt

[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![DSH](https://img.shields.io/badge/DSH-0.2.1--rc.2-blue)](https://github.com/deepseek-ai/deepseek-harness)
[![Node](https://img.shields.io/badge/node-%3E%3D22-green)](package.json)

DSH（DeepSeek Harness）原生增强提示词插件：把输入框草稿交给大模型改写得更清晰、更具体，三拍循环切换，结果缓存复用。

![输入框增强按钮](./screenshot.png)

## 功能

- **三拍循环按钮**：点一下增强，再点回原文，再点又显示上次结果 —— 反复切换不再重复请求模型
- **增强结果缓存**：同一份草稿 + 同一个模型时，第 2、3 次点击直接复用，不消耗调用配额；只有换模型或改草稿才会重新生成
- **三档模型路由**：省 token / 平衡 / 最强，可按需切换，失败自动向上升级
- **可选上下文增强**：把当前会话摘要（意图 / 工具动作 / 触碰的文件）一并发给模型，帮助消解指代歧义
- **省 token 优先**：默认走低延迟通道，避免每次增强都消耗最贵的模型

### 三拍循环怎么点

| 点击 | 显示 | 是否调用模型 |
|---|---|---|
| 第 1 次 | 增强结果 | 首次调用；已有缓存则直接复用 |
| 第 2 次 | 原始输入 | 不调用 |
| 第 3 次 | 上次的增强结果 | 不调用（读缓存） |
| 第 4 次起 | 在第 2、3 拍之间交替 | 不调用 |

缓存只在两种情况下失效：**换了增强所用模型**，或**手动改了草稿**。

## 安装

需要 DSH `0.2.1-rc.2` 或更高版本，Node.js >= 22。

```bash
# 1. 克隆到插件目录
git clone https://github.com/dbq7czj-bot/-dsh-enhance-prompt.git \
  ~/.dsh/plugins/dsh-enhance-prompt

# 2. 链接到你的 profile（把 <profile> 换成你实际在用的 profile 名）
cd ~/.dsh/profiles/<profile>
npm install --save file:../../plugins/dsh-enhance-prompt
```

然后在同一个 profile 的 `package.json` 里把插件加入 bundle 列表：

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "dsh-enhance-prompt"
      ]
    }
  }
}
```

最后把 `cordis.patch.yml` 加入 profile 的 patch 配置（内容见该文件，仅一条 `insert` 记录），重启 DSH。

## 配置

### 模型路由（可选）

默认情况下三个档位都使用**宿主当前的默认模型**，开箱即用。若想指定具体通道，在你的 profile `package.json` 里加：

```json
{
  "dsh": {
    "enhancePrompt": {
      "tiers": {
        "cheap": [
          { "provider": "your-provider", "model": "your-fast-model", "label": "快速通道" }
        ],
        "balanced": [
          { "provider": "your-provider", "model": "your-strong-model", "label": "稳定通道" }
        ]
      }
    }
  }
}
```

不配置时不会去尝试任何不存在的 provider。

### 档位行为

| 档位 | 行为 |
|---|---|
| `cheap` | 先试 tiers.cheap，再试 tiers.balanced，最后宿主默认 |
| `balanced` | 先试 tiers.balanced，最后宿主默认 |
| `strong` | 直接使用宿主默认模型 |

客户端选择会存到 `localStorage` 的 `dsh-enhance-prompt:tier`。

## 上下文增强：读到的是会话日志本身

大多数增强插件会把「最近几条对话」拼进 prompt。本插件不同——它直接读 DSH 的会话日志文件
（`~/.dsh/sessions/<projectKey>/<session-id>/session.v4.jsonl.zstd`），按需解码其中的帧。

### 它实际做了什么

会话日志是**多帧拼接的 zstd 容器**：每帧独立可解压，帧内是若干行 JSONL。本插件：

- **只解需要的帧**，不全量解压。典型会话 1848 帧、2.7 MB 压缩、8.7 MB 明文，读取耗时约 12 ms
- **按 seq 二分定位**：seq 在日志里单调递增，因此可以跳过无关帧
- **15 档渐进式预算裁剪**：从最不值钱的内容开始砍（工具流水 → 助手结论 → 用户意图），每档重测一次，够用就停
- **只认真正由人发出的消息**：DSH 会往日志里插 `runtime-context`、`skill-catalog`、`tool-jobs` 等合成消息，这些会被排除，不会污染摘要

### 产出什么

摘要由五部分组成，每部分都带 `seq` 便于追溯：

| 部分 | 内容 |
|---|---|
| `userIntents` | 用户历次真实意图 |
| `assistantGist` | 助手的关键结论 |
| `toolTrace` | 工具调用及成功/失败状态 |
| `filesTouched` | 本次会话读写过的文件路径 |
| `attachments` | 附件指针（只存路径与元信息，不塞 base64） |

### 定向读取

除了自动摘要，还可以用 key 精确取内容：

| key 形式 | 取什么 |
|---|---|
| `file:/abs/path` | 指定文件的文本内容 |
| `seq:120-160` | 该 seq 区间的原始记录 |
| `call:CALL_ID` | 某次工具调用的参数与结果 |
| `attachment:sha256:...` | 附件的对象路径与元信息 |

### 与「只塞最近对话」的区别

| | 只塞最近对话 | 本插件 |
|---|---|---|
| 数据来源 | 内存里的消息列表 | 持久化日志文件 |
| 时间跨度 | 受上下文窗口限制 | 整个会话历史，含已被压缩遮蔽的部分 |
| 工具调用 | 通常不包含 | 含参数、结果、成败状态 |
| 文件线索 | 无 | 有，精确到路径与操作类型 |
| 成本 | 随历史线性增长 | 按预算裁剪，可控 |

启用方式：输入框旁的「上下文」胶囊按钮。默认关闭，开启后会把摘要并入增强请求。

## HTTP 接口

插件注册两个端点，均只接受 `POST`，监听 `127.0.0.1`。

### `POST /dsh-enhance-prompt/enhance`

请求：

```json
{
  "text": "要增强的草稿（必填）",
  "provider": "可选，手动指定 provider",
  "model": "可选，手动指定 model",
  "effort": "可选，reasoning effort",
  "tier": "可选，cheap | balanced | strong，默认 cheap",
  "context": {
    "sessionId": "可选，带上会话摘要",
    "budgetTokens": 1200
  }
}
```

响应：

```json
{
  "ok": true,
  "text": "增强后的提示词",
  "model": { "provider": "...", "model": "..." },
  "tier": "cheap",
  "attempts": [{ "provider": "...", "model": "...", "ok": true }]
}
```

可能的错误码：`400` 空草稿或 JSON 非法、`413` 请求体超 64 KB、`502` 所有候选模型均失败、`503` 无可用模型。

### `POST /dsh-enhance-prompt/context`

读取会话日志并产出摘要。

请求：

```json
{
  "sessionId": "必填",
  "cwd": "可选，会话工作目录（能显著加快定位）",
  "scope": "可选，auto | recent | full",
  "budgetTokens": 2000,
  "keys": ["可选，定向读取：file:/abs/path | seq:1-20 | call:CALL_ID | attachment:sha256:..."],
  "roots": ["可选，file: key 的额外允许根目录"],
  "redact": true
}
```

响应包含 `digest`（结构化摘要）、`reads`（定向读取结果）、`stats`（统计）、`rendered`（可直接粘贴的文本）。

**安全约束**：`file:` 读取默认只允许会话工作目录内的文件；需要读其他位置必须显式传 `roots`。路径会先 `realpath` 解析符号链接再校验，防止越权。

## 已知限制

- 增强输出上限约 800 字符，超长草稿会被压缩，信息损失明显
- 请求体上限 64 KB，超出返回 413
- 超过 20 万帧的会话日志会被截断扫描，并给出警告
- 「最强」档并不保证使用当前会话所选模型，而是使用宿主默认模型

## 文档

- [MODELS.md](./MODELS.md) —— 模型路由、失败升级、上下文读取机制的详细说明

## 许可证

[MIT](./LICENSE)
