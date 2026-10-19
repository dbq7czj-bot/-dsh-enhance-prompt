# dsh-enhance-prompt — 模型通道与上下文机制

> 本文件描述插件在 `~/.dsh/profiles/desktop` 里实际运行的模型调用路径与上下文读取机制。
> 所有数值均来自本机实测，不是估算。

---

## 一、为什么要做分层路由

增强任务本身很轻：输入是一段输入框草稿，输出上限 800 字符，不需要长上下文推理。
但本机实测发现，**不同 provider 的延迟差 10 倍以上**：

| 模型 | 延迟（3 次中位） |
|---|---|
| `our-free-model/kilo-auto/free` | 1.6 s |
| `buddy/deepseek-v4-flash` | 2.5 s |
| `workbuddy-ai/glm-5.3-flash` | 3.4 s |
| `workbuddy-ai/hy3` | 25 s |

同时免费渠道有积分/配额限制，不适合做无脑默认；付费通道稳定但成本高。

**结论：选对模型比少读上下文更省。** 因此做成三层。

---

## 二、三层档位

| 档位 | 候选顺序 | 适用 |
|---|---|---|
| `cheap`（默认） | `our-free-model/kilo-auto/free` → `buddy/deepseek-v4-flash` → balanced 全部 → strong | 日常增强 |
| `balanced` | `workbuddy/deepseek-v4.1-flash` → `workbuddy-ai/deepseek-v4.1-flash-sg` → `workbuddy-ai/glm-5.3-flash` → strong | 免费线不稳时 |
| `strong` | 当前会话所选模型 | 质量优先 |

`strong` 层的候选在运行时从会话 projection 的 `modelSelection` 注入，不写死在表里。

### 失败升级规则

```
cheap      → cheap → balanced → strong
balanced   → balanced → strong
strong     → strong
```

逐个试，第一个返回非空文本即停。全部失败才报错。

### 用户显式选择优先

如果用户在下拉里手动选了具体模型，**只试那一个，不做 failover**。
理由：手动选择代表明确意图，自动换模型会让结果不可预期。

---

## 三、实测可用模型（2026-10-19）

```
OK    buddy/deepseek-v4-flash
OK    workbuddy-ai/hy3
OK    workbuddy-ai/deepseek-v4.1-flash-sg
OK    workbuddy-ai/glm-5.3-flash
OK    workbuddy-ai/step-5-preview
OK    workbuddy/hy3
OK    workbuddy/deepseek-v4.1-flash
OK    our-free-model/kilo-auto/free
FAIL  workbuddy-ai/deepseek-v4.1-flash
FAIL  workbuddy-ai/gemini-3.5-flash
FAIL  workbuddy-ai/gpt-6-luna
FAIL  workbuddy-global/deepseek-v4.1-flash
FAIL  opencode/*
FAIL  our-free-model/glm-5.3-flash-free
FAIL  modlens-opencode/deepseek-v4-flash
```

失败的多为「模型 id 在该 provider 下不存在」或「渠道未登录」。
路由表只收录实测 OK 的，避免默认路径踩坑。

---

## 四、请求路径

```
[浏览器] EnhanceButton.run()
   │  POST /dsh-enhance-prompt/enhance
   │  body: { text, provider?, model?, effort?, tier?, context? }
   ▼
[Node 半] lib/index.js handler
   │  ① 决定候选列表（显式 or 按 tier 展开）
   │  ② 读上下文摘要（可选，失败降级）
   │  ③ 逐个 llm.stream()
   ▼
[DSH 内核] LlmRuntime.streamWithRegistration()
   │  ctx.waterfall(this, "llm/stream", options, ...)
   ▼
LlmRuntime.adapterStream()
   │  registration(options.provider)  → 找 adapter
   │  adapter.prepareCall(provider, model)
   │  adapterCall.stream(options)     → 真正 HTTP
```

### 无会话调用

`llm.stream()` **不传 `sessionId`**，因此：

- `dsh-session-checkpoint-policy` 的钩子首行 `if (options.sessionId === void 0) return next()` → 直接放行
- `dsh-session-title` 的 `onMainRequest` 要求 `isAgentLoopRequest` 且 sessionId 匹配 → 不触发

增强请求不落会话、不改标题、不占 turn。这是刻意设计。

---

## 五、上下文读取机制

### 5.1 数据源

会话日志是**多帧拼接 zstd**：

```
~/.dsh/sessions/<projectKey>/<session-id>/session.v4.jsonl.zstd
```

- projectKey 编码：路径分隔符 → `-`，非 `[A-Za-z0-9._-]` 字符 → `~XXXX`，整体包 `--...--`
- 每帧独立可解压，帧内是若干行 JSONL
- 首帧只含 1 行 header

实测：2.87 MB 压缩 → 8.70 MB 明文，1848 帧，全量逐帧解码 46 ms。

### 5.2 读取流程

```
[1] 定位      cwd → projectKey → sessionDir；猜不到就扫根目录
[2] 帧扫描    scanZstdFrames()：只走帧头/块头，不解压
[3] 选择性解压 auto 模式只解「尾部 120 帧 + 头部 6 帧」
[4] 瘦身      丢弃 assistant/message.data.stream、reasoning 块
[5] 折叠      compaction/prune.shadowedSeqs 命中的记录不计入
[6] 抽取      标题/模型/意图/结论/工具/文件/附件
[7] 定向读取  按 key 取实体（attachment/file/seq/call）
[8] 预算裁剪  15 档渐进，够用即停
```

### 5.3 只认真实用户意图

DSH 会往日志里插合成消息，必须过滤：

```js
const kind = data.source && data.source.kind;
if (text && kind === "user") { /* 才计入 userIntents */ }
```

实测分类：

```
user            54   ← 真实意图
runtime-context  1   ← 系统注入，排除
skill-catalog    4   ← 系统注入，排除
model-selection  7   ← 模型切换通知，排除
tool-jobs       15   ← 后台任务通知，排除
```

### 5.4 预算与 token 实测

| 预算设置 | 实际占用 | 输入合计（含 system+模板） |
|---|---|---|
| 关闭上下文 | 0 | 438 token |
| 400 | 133 | 571 token |
| 800 | 546 | 984 token |
| 1200 | 696 | 1134 token |
| 2000 | 1400 | 1838 token |

客户端默认传 `budgetTokens: 1200`。

**省 token 的关键不在压预算，而在选模型**——`hy3` 跑 25 秒的调用，换成 `kilo-auto/free` 只要 1.6 秒，token 单价还更低。

### 5.5 摘要与实体分离

`digest.attachments[]` 里只有**指针**：

```json
{ "attachmentId": "sha256:3f37...", "bytes": 745001,
  "objectPath": "~/.dsh/attachments/v1/objects/3f/3f3716..." }
```

图片本体不进 prompt。要实体就传 `keys: ["attachment:sha256:..."]` 二次读取。
否则一张 745 KB 的截图会直接烧掉上下文窗口。

### 5.6 缓存

| 缓存 | 键 | 失效条件 |
|---|---|---|
| digest | `sessionId|scope` | 文件 revision（dev/ino/size/mtimeNs/ctimeNs）变化 |
| 帧 seq 索引 | `sessionId` | 同上 |

**缓存的是未裁剪的 digest**，命中后再按本次预算裁剪。
否则小预算请求会拿到上一轮大预算的胖结果（这个 bug 已修）。

---

## 六、失败信息不再被吞

DSH 的 adapter 失败不抛异常，而是 yield 终态 chunk：

```js
{ type: "finish", reason: { kind: "error", failure: { code, status, message } } }
```

旧版 `collectStreamText()` 完全忽略 `finish`，所有错误都被压成 `model returned empty result`。
现在会提取 `code / status / message`，并逐候选记录：

```json
{
  "ok": false,
  "error": "all candidate models failed",
  "attempts": [
    { "provider": "our-free-model", "model": "kilo-auto/free",
      "ok": false, "error": "QUOTA_EXCEEDED / 402 / Insufficient Balance" },
    { "provider": "buddy", "model": "deepseek-v4-flash", "ok": true }
  ]
}
```

---

## 七、取消与中断

### 问题

`fetch(..., { signal })` 的 abort 只断开浏览器这一侧。服务端的 `llm.stream()`
不知道用户已经走了，会把整个生成过程跑完——token 照扣、免费渠道积分照消耗。

实测（未修复时）：客户端 1 秒 abort，模型仍产出全部 6 个 token 并「正常跑完」。

### 修复

三层联动：

1. **`readBody()` 监听 `request.on("close")`** —— 客户端在读完 body 前断开时让 promise 结束，
   否则 handler 永远挂着。
2. **`abortOnDisconnect(response)`** —— 把 `AbortController` 绑到响应生命周期：
   ```js
   response.on("close", () => {
     if (!response.writableEnded) controller.abort(...);
   });
   ```
   判断 `writableEnded` 是因为正常结束时 close 也会触发，那时不该 abort。
3. **`llm.stream({ ..., signal })`** —— 把 signal 透传给 DSH 内核，adapter 会把它
   传到底层 HTTP 请求。

### 候选循环的额外保护

```js
for (const cand of candidates) {
  if (signal.aborted) {
    attempts.push({ ...cand, ok: false, error: "aborted before dispatch" });
    break;   // 取消后不再尝试下一个
  }
  ...
}
```

**没有这一条，第一个候选失败后会自动升级到第二个，即使用户早就走了** —— 等于取消后
还额外多扣一次。

### 修复后实测

```
客户端 1001ms abort
[模型] 收到请求 signal=有
[模型] 产出第 0 个 token
[模型] 产出第 1 个 token
[模型] 第 2 步检测到 abort，提前退出     ← 停止
```

取消后 failover 测试：

```
实际调用过的模型: [ 'our-free-model/kilo-auto/free' ]
✅ 只调用了 1 个（未继续升级）
```

---

## 八、已知限制

1. **profile 里是独立副本**，不是硬链接。改源目录后必须手动 `cp` 或重跑 `pnpm install`。
   只有 `package.json` 是硬链接（inode 相同）。
2. **格式绑死 v4 + zstd**。官方换 `session.v5` 时需要在 `createContextReader({ version })` 处加探测。
3. **取消的粒度是「候选之间」**，不是「token 之间」。signal 已传给 adapter，
   但底层是否在每个 chunk 之间检查取决于 adapter 实现；DSH 的 `adapterStream` 会在
   迭代中断时调用 `iterator.return()`。
