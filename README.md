# dsh-enhance-prompt

DSH（DeepSeek Harness）原生增强提示词插件：把输入框草稿交给大模型改写得更清晰、更具体，原地替换，可一键恢复。

## 功能

- **输入框魔棒按钮**：点一下把草稿改写成更明确的提示词，再点一下恢复原文
- **三档模型路由**：省 token / 平衡 / 最强，可按需切换，失败自动向上升级
- **可选上下文增强**：把当前会话摘要（意图 / 工具动作 / 触碰的文件）一并发给模型，帮助消解指代歧义
- **省 token 优先**：默认走低延迟通道，避免每次增强都消耗最贵的模型

## 安装

需要 DSH `0.2.1-rc.2` 或更高版本，Node.js >= 22。

```bash
# 1. 把本包放到插件目录
git clone <repo-url> ~/.dsh/plugins/dsh-enhance-prompt

# 2. 链接到你的 profile（以 desktop 为例）
cd ~/.dsh/profiles/desktop
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
