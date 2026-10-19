/**
 * dsh-enhance-prompt — 单文件完整实现（node 侧）
 * ============================================================================
 *
 * 本文件把插件运行所需的全部 node 侧代码合并为一份可独立运行的 ES 模块：
 *
 *   Part 1  压缩上下文读取器      （原 lib/context.js 全文）
 *   Part 2  HTTP 路由 + 增强主流程（原 lib/index.js  全文）
 *
 * 对外接口与多文件版本完全一致：
 *
 *   export const name   = "dsh-enhance-prompt"
 *   export const inject = ["webServer"]
 *   export function apply(ctx)
 *
 * 以及仍然公开的工具函数（原 context.js 的具名导出，行为不变）：
 *
 *   scanZstdFrames(buffer, maxFrames?)
 *   attachmentObjectPath(attachmentId)
 *   redactText(text, enabled?)
 *   digestOf(records, options?)
 *   fitBudget(digest, budgetTokens)
 *   renderDigest(digest, options?)
 *   resolveKey(key, ctx)
 *   createContextReader(config?)
 *
 * HTTP 端点（与多文件版本同路径、同语义）：
 *
 *   POST /dsh-enhance-prompt/enhance  { text, provider?, model?, effort?, tier?, context? }
 *        -> 200 { ok, text, model?, tier, attempts, context? }
 *        -> 400 invalid JSON body / empty draft
 *        -> 502 all candidate models failed
 *        -> 503 llm service unavailable / no llm provider available
 *
 *   POST /dsh-enhance-prompt/context  { sessionId, cwd?, scope?, budgetTokens?, keys?, redact? }
 *        -> 200 { ok, digest?, reads, stats, warnings, rendered?, error? }
 *
 * ----------------------------------------------------------------------------
 * 无法并入本文件的外部资源（共 4 项，均为运行必需或可选增强）
 * ----------------------------------------------------------------------------
 *
 * 1) cordis.patch.yml  —— 插件注册清单，**必需**
 *    放置位置：与本文件同级的插件包根目录
 *              （如 ~/.dsh/plugins/dsh-enhance-prompt/cordis.patch.yml）
 *    加载方式：由 DSH 的 bundle 机制读取 —— package.json 里
 *              "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
 *              指向它。内容等价于：
 *
 *                - insert:
 *                    - id: dsh-enhance-prompt
 *                      name: dsh-enhance-prompt
 *                      inject: [webServer]
 *
 *              这份 YAML 无法写进 JS：它是在任何 JS 被解析之前，
 *              由宿主的 patch 合并器先读的，用来决定要不要加载本模块。
 *
 * 2) client.js  —— 浏览器侧 UI，**必需**（否则没有可点的按钮）
 *    放置位置：插件包根目录，由 package.json 的
 *              "dsh": { "client": { "platform": "web", "inject": [...] } }
 *              以及 "exports": { "./client": "./client.js" } 指向。
 *    加载方式：DSH 把 client.js 作为独立模块下发到 Web 前端，
 *              在 window.__ModuleLoader__.load({ id, factory }) 里执行。
 *              它必须在浏览器上下文里跑（用到 React、document、localStorage、
 *              fetch），与本文件的 Node 上下文不是同一个运行时，
 *              物理上无法合并进同一个模块。
 *    它只通过 fetch 调用本文件的 HTTP 端点，两者之间没有模块级依赖。
 *
 * 3) package.json  —— 包元数据，**必需**
 *    放置位置：插件包根目录
 *    加载方式：Node 解析包名 "dsh-enhance-prompt" 时的入口声明。
 *              自 0.2.0 起 "main" 与 "exports[\".\"]" 都直接指向本文件
 *              （"./dsh-enhance-prompt.single.mjs"），因此本文件就是唯一实现，
 *              不再有 lib/index.js 这一层。同时声明 dsh.bundle.patch /
 *              dsh.client 两份清单。
 *
 * 4) @deepseek-ai/dsh-llm  —— 第三方依赖，**可选**
 *    放置位置：由宿主提供（Node 正常 resolve 路径即可），无需随本包分发。
 *    加载方式：代码里有一处动态 import：
 *                const { BlockAssembler } = await import("@deepseek-ai/dsh-llm");
 *              已经用 try/catch 包住。解析失败时自动退回纯文本累积路径，
 *              增强功能不受影响（仅少了官方块组装器的去重能力）。
 *              保留动态 import 而不改成顶层静态 import，正是为了让它保持可选：
 *              静态 import 一旦解析失败会让整个插件加载失败。
 *
 * 另有一项非运行必需、也未被任何代码引用的静态资源：
 *
 *    assets/icon-sparkle.svg  —— 设计稿留档，图标实际以 inline SVG 写在
 *                                client.js 的 IconWand() 里，本文件不加载它。
 *
 * ----------------------------------------------------------------------------
 * 合并说明：本文件为纯自动化机械合并的产物
 * ----------------------------------------------------------------------------
 * - 两个原模块之间原本只有一条依赖：index.js 从 context.js 导入
 *   createContextReader 与 renderDigest。合并后同处一个模块作用域，
 *   该 import 已删除，两个符号直接可见。
 * - 两侧共 50 个顶层标识符经程序比对无重名，不存在命名冲突。
 * - node:fs / node:os / node:path / node:zlib 原本在 context.js 顶层导入、
 *   在 index.js 里以 await import() 局部导入；合并后统一提到文件顶部，
 *   消除重复定义。await import() 与静态 import 拿到的是同一个模块对象，
 *   行为等价。
 * - 唯一的循环依赖风险点（index -> context）随合并消失。
 * - 两个原模块各自的顶部 JSDoc 块注释（分别描述"压缩上下文读取器"与
 *   "node half"）已被本文件头部的统一说明取代，避免同一份文件里出现两段
 *   互相矛盾的模块级注释；正文内的所有行内注释、字符串、默认值、错误文案
 *   全部逐字节保留，未做任何改写。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

// ═══════════════════════════════════════════════════════════════════════════
// PART 1 / 2 — 压缩上下文读取器（合并自 lib/context.js）
// ═══════════════════════════════════════════════════════════════════════════

// ── 常量 ──────────────────────────────────────────────────────────────

const ZSTD_MAGIC = 0xfd2fb528; // 小端读为 4247762216
const SESSION_FORMAT_VERSION = 4;
const SESSIONS_ROOT = path.join(os.homedir(), ".dsh", "sessions");
const ATTACHMENTS_ROOT = path.join(os.homedir(), ".dsh", "attachments", "v1", "objects");

const DEFAULTS = {
  scope: "auto", // auto | recent | full
  budgetTokens: 2000,
  maxFramesRecent: 120, // auto 模式最多回溯的帧数
  headFrames: 6, // auto 模式额外解压的开头帧数（header / 标题 / 首批附件都在这）
  textClip: 240, // 单条文本截断字数
  fileReadLimit: 256 * 1024,
  digestCacheEntries: 8,
  redact: true,
};

/** 帧扫描时最多收集的帧数（防超大文件把内存吃满） */
const MAX_FRAMES = 200_000;

// ── 路径编码（与 dsh-session-persistence-jsonl 的 projectKey/encodeSegment 同构）──

function encodeSegment(raw) {
  if (raw === "") throw new Error("cannot encode an empty path segment");
  if (raw === ".") return "~002E";
  if (raw === "..") return "~002E~002E";
  let out = "";
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i);
    const ch = String.fromCharCode(code);
    if (ch !== "~" && /^[A-Za-z0-9._-]$/.test(ch)) out += ch;
    else out += "~" + code.toString(16).toUpperCase().padStart(4, "0");
  }
  return out;
}

function projectKey(cwd) {
  if (typeof cwd !== "string" || cwd.length === 0) {
    throw new Error("cannot encode an empty project path");
  }
  let readable = "";
  let separatorRun = false;
  for (let i = 0; i < cwd.length; i += 1) {
    const code = cwd.charCodeAt(i);
    const ch = String.fromCharCode(code);
    if (ch === "/" || ch === "\\" || ch === ":") {
      if (!separatorRun) readable += "-";
      separatorRun = true;
    } else if (ch !== "~" && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch;
      separatorRun = false;
    } else {
      readable += "~" + code.toString(16).toUpperCase().padStart(4, "0");
      separatorRun = false;
    }
  }
  return `--${(readable.replace(/^-+/, "") || "root").slice(0, 251)}--`;
}

function logPath(root, cwd, id, version = SESSION_FORMAT_VERSION) {
  const projectDir =
    cwd === undefined ? path.join(root, "_no-cwd") : path.join(root, projectKey(cwd));
  return path.join(projectDir, encodeSegment(id), `session.v${version}.jsonl.zstd`);
}

// ── 帧扫描：只走帧头/块头，不解压 ─────────────────────────────────────

/**
 * 定位完整帧区间。结构非法直接抛（调用方降级）；尾部不完整帧记为 tornStart。
 * 规则与官方 scanZstdFrames 一致：magic → descriptor → 剩余头 → 块循环 → checksum。
 */
export function scanZstdFrames(buffer, maxFrames = MAX_FRAMES) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) return { frames, tornStart: start };
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error(`corrupt zstd session log: invalid frame magic at byte ${offset}`);
    }
    offset += 4;
    if (offset === buffer.length) return { frames, tornStart: start };

    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    if ((descriptor & 24) !== 0) {
      throw new Error(`corrupt zstd session log: reserved frame-header bit at byte ${offset - 1}`);
    }
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 32) !== 0;
    const checksum = (descriptor & 4) !== 0;
    const dictionaryFlag = descriptor & 3;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < remainingHeaderBytes) return { frames, tornStart: start };
    offset += remainingHeaderBytes;

    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start };
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 3;
      const blockSize = blockHeader >>> 3;
      if (blockType === 3) {
        throw new Error(`corrupt zstd session log: reserved block type at byte ${offset - 3}`);
      }
      const payloadBytes = blockType === 1 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start };
      offset += payloadBytes;
      if (lastBlock) break;
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start };
      offset += 4;
    }
    frames.push({ start, end: offset });
    if (frames.length >= maxFrames) {
      return { frames, maxFramesReached: offset < buffer.length };
    }
  }
  return { frames };
}

/** 解压单帧并切行（不含空行），解析失败的行返回 null 占位 */
function decodeFrame(buffer, frame) {
  const plain = zlib.zstdDecompressSync(buffer.subarray(frame.start, frame.end));
  const text = plain.toString("utf8");
  const records = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      records.push(null);
    }
  }
  return { records, plaintextBytes: plain.length };
}

function decodeFrameLines(buffer, frame) {
  return decodeFrame(buffer, frame).records;
}

// ── 瘦身与抽取 ────────────────────────────────────────────────────────

/** 估算 token：中文按 1 字 1 token，其余按 4 字符 1 token 粗算 */
function approxTokens(text) {
  if (!text) return 0;
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    if (/[\u3400-\u9fff\uf900-\ufaff]/.test(ch)) cjk += 1;
    else other += 1;
  }
  return cjk + Math.ceil(other / 4);
}

function clip(text, limit) {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  if (s.length <= limit) return s;
  return s.slice(0, limit) + "…";
}

/** 只取 message 里的纯文本块，跳过 reasoning / tool-call / image */
function textOfMessage(message) {
  if (!message || !Array.isArray(message.content)) return "";
  const parts = [];
  for (const block of message.content) {
    if (!block || block.type !== "text") continue;
    if (typeof block.text === "string") parts.push(block.text);
  }
  return parts.join("\n").trim();
}

function toolCallOfMessage(message) {
  if (!message || !Array.isArray(message.content)) return [];
  const out = [];
  for (const block of message.content) {
    if (!block || block.type !== "tool-call") continue;
    let args = "";
    try {
      args = typeof block.arguments === "string" ? block.arguments : JSON.stringify(block.arguments);
    } catch {
      args = "";
    }
    out.push({ callId: block.id, name: block.name, arguments: args });
  }
  return out;
}

/** 从 tool-call 参数里抠出目标路径（write/edit/read/present 的 file_path、path、files[]） */
function pathsInToolArgs(argsText) {
  const out = [];
  let parsed;
  try {
    parsed = JSON.parse(argsText);
  } catch {
    return out;
  }
  if (!parsed || typeof parsed !== "object") return out;
  const push = (v) => {
    if (typeof v === "string" && v.startsWith("/")) out.push(v);
  };
  push(parsed.file_path);
  push(parsed.path);
  if (Array.isArray(parsed.files)) {
    for (const f of parsed.files) {
      if (f && typeof f === "object") push(f.path);
      else push(f);
    }
  }
  // bash 里的绝对路径也算「触碰」，但噪声太大，只收 read/write/edit/present
  return out;
}

const FILE_OPS = new Set(["read", "write", "edit", "present", "read_image"]);

/** 收集会话里出现过的附件引用 */
function attachmentsOfMessage(message) {
  const out = [];
  if (!message || !Array.isArray(message.content)) return out;
  for (const block of message.content) {
    const ref = block && block.attachment;
    if (!ref || typeof ref !== "object") continue;
    if (typeof ref.attachmentId !== "string" || !ref.attachmentId) continue;
    out.push({
      attachmentId: ref.attachmentId,
      mediaType: ref.mediaType,
      bytes: ref.bytes,
      width: ref.width,
      height: ref.height,
      name: ref.name,
    });
  }
  return out;
}

/**
 * attachmentId 形如 sha256:<64hex> → objects/<前2>/<完整64hex>
 * 与 @deepseek-ai/dsh-attachment-local 的布局一致（文件名是完整 sha256，不是后 62 位）。
 */
export function attachmentObjectPath(attachmentId) {
  const m = /^sha256:([0-9a-f]{64})$/i.exec(String(attachmentId || ""));
  if (!m) return null;
  const hex = m[1].toLowerCase();
  return path.join(ATTACHMENTS_ROOT, hex.slice(0, 2), hex);
}

// ── 帧级 seq 索引 ─────────────────────────────────────────────────────

/** 单帧首行/末行的 seq（只解一次，只取边界） */
function frameBounds(raw, frame) {
  try {
    const plain = zlib.zstdDecompressSync(raw.subarray(frame.start, frame.end)).toString("utf8");
    const lines = plain.split("\n").filter(Boolean);
    let first = null;
    let last = null;
    for (const line of lines) {
      try {
        const rec = JSON.parse(line);
        if (rec && typeof rec.seq === "number") {
          if (first === null) first = rec.seq;
          last = rec.seq;
        }
      } catch {
        /* skip malformed line */
      }
    }
    return { first, last };
  } catch {
    return { first: null, last: null };
  }
}

/**
 * 为所有帧建 seq 边界索引。seq 单调递增，因此可以用二分定位。
 * 结果按 (sessionId, revision) 缓存在读取器内，避免每次 key 查询重扫。
 */
function buildFrameSeqIndex(raw, frames) {
  const index = [];
  for (let i = 0; i < frames.length; i += 1) {
    const b = frameBounds(raw, frames[i]);
    index.push({ i, first: b.first ?? -1, last: b.last ?? -1 });
  }
  return index;
}

// ── 脱敏 ──────────────────────────────────────────────────────────────

const REDACT_RULES = [
  // 常见密钥
  [/\b(sk|pk|ghp|gho|ghs|xoxb|xoxp|AKIA)[-_A-Za-z0-9]{12,}\b/g, "$1***"],
  [/\bBearer\s+[A-Za-z0-9._\-]{16,}/g, "Bearer ***"],
  // 长 hex（疑似 token / hash 泄露，保留附件 id 的前缀形态）
  [/\b[a-f0-9]{40,}\b/gi, (m) => m.slice(0, 8) + "***"],
  // 家目录绝对路径压成 ~
  [new RegExp(escapeRe(os.homedir()), "g"), "~"],
];

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function redactText(text, enabled = true) {
  if (!enabled || typeof text !== "string" || !text) return text;
  let out = text;
  for (const [re, rep] of REDACT_RULES) {
    try {
      out = out.replace(re, rep);
    } catch {
      /* 单条规则失败不影响其它 */
    }
  }
  return out;
}

// 对外返回上下文时统一脱敏。结构性 ID 保持原样，以免破坏附件/工具调用引用。
const REDACT_PRESERVE_KEYS = new Set([
  "attachmentId", "callId", "toolCallId", "sessionId", "provider", "model",
  "type", "kind", "mediaType", "seq", "turn", "time", "bytes", "width",
  "height", "count", "ok", "lastSeq", "shadowedCount", "shadowedTokenCount",
  "truncated", "ops",
  // 结构性路径：脱敏会把 ~ 与长 hex 规则套在上面，导致 objectPath / cwd / path
  // 变成不可用值（客户端回传 cwd 会让 allowedRoots 解析失败）。路径本身不是自由
  // 文本，泄露面由 allowedRoots 读取白名单控制，这里保持原样。
  "cwd", "path", "objectPath", "file",
]);

function redactOutput(value, enabled = true, key = "") {
  if (!enabled || value == null) return value;
  if (typeof value === "string") {
    return REDACT_PRESERVE_KEYS.has(key) ? value : redactText(value, true);
  }
  if (Array.isArray(value)) return value.map((item) => redactOutput(item, true, key));
  if (typeof value === "object") {
    const out = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      out[childKey] = redactOutput(childValue, true, childKey);
    }
    return out;
  }
  return value;
}


// ── 摘要构建 ──────────────────────────────────────────────────────────

/**
 * 把一批已解压的记录折成 digest。
 * records 顺序即日志顺序（seq 单调递增）。
 */
export function digestOf(records, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const shadowed = new Set();

  // 第一遍：收集 compaction/prune 的 shadowedSeqs
  for (const rec of records) {
    if (!rec || rec.type !== "compaction/prune") continue;
    const list = rec.data && rec.data.shadowedSeqs;
    if (Array.isArray(list)) for (const s of list) shadowed.add(s);
  }

  const digest = {
    sessionId: null,
    title: null,
    cwd: null,
    model: null,
    startedAt: null,
    lastSeq: 0,
    userIntents: [],
    assistantGist: [],
    toolTrace: [],
    filesTouched: [],
    attachments: [],
    compactions: [],
    shadowedCount: 0,
    warnings: [],
  };

  const fileMap = new Map(); // path → { path, ops:Set, lastSeq }
  const attachSeen = new Set();
  const callResult = new Map(); // callId → { ok, summary }

  for (const rec of records) {
    if (!rec || typeof rec.type !== "string") continue;
    if (typeof rec.seq === "number" && rec.seq > digest.lastSeq) digest.lastSeq = rec.seq;
    if (shadowed.has(rec.seq)) {
      digest.shadowedCount += 1;
      continue;
    }
    const data = rec.data || {};

    switch (rec.type) {
      case "session": {
        digest.sessionId = data.id ?? digest.sessionId;
        digest.cwd = data.cwd ?? digest.cwd;
        digest.startedAt = data.createdAt ?? digest.startedAt;
        break;
      }
      case "session/title": {
        if (typeof data.title === "string" && data.title) digest.title = data.title;
        break;
      }
      case "model/selection":
      case "request/context": {
        if (data.provider) {
          digest.model = { provider: data.provider, model: data.model };
        }
        break;
      }
      case "user/message": {
        const text = textOfMessage(data);
        // 只认真正由人发出的消息：DSH 会往日志里插 runtime-context / skill-catalog /
        // tool-jobs / model-selection 等合成消息，它们不是用户意图。
        const kind = data.source && data.source.kind;
        if (text && kind === "user") {
          const prev = digest.userIntents[digest.userIntents.length - 1];
          if (!prev || prev.text !== clip(text, opts.textClip)) {
            digest.userIntents.push({
              seq: rec.seq,
              time: rec.time,
              text: clip(text, opts.textClip),
            });
          }
        }
        for (const a of attachmentsOfMessage(data)) {
          if (attachSeen.has(a.attachmentId)) continue;
          attachSeen.add(a.attachmentId);
          digest.attachments.push({ ...a, objectPath: attachmentObjectPath(a.attachmentId) });
        }
        break;
      }
      case "assistant/message": {
        const text = textOfMessage(data.message);
        if (text) {
          digest.assistantGist.push({
            seq: rec.seq,
            turn: data.turn,
            text: clip(text, opts.textClip),
          });
        }
        for (const call of toolCallOfMessage(data.message)) {
          digest.toolTrace.push({
            seq: rec.seq,
            turn: data.turn,
            callId: call.callId,
            name: call.name,
            argsDigest: clip(call.arguments, 120),
          });
          if (FILE_OPS.has(call.name)) {
            for (const p of pathsInToolArgs(call.arguments)) {
              const entry = fileMap.get(p) || { path: p, ops: new Set(), lastSeq: 0 };
              entry.ops.add(call.name);
              entry.lastSeq = rec.seq;
              fileMap.set(p, entry);
            }
          }
        }
        for (const a of attachmentsOfMessage(data.message)) {
          if (attachSeen.has(a.attachmentId)) continue;
          attachSeen.add(a.attachmentId);
          digest.attachments.push({ ...a, objectPath: attachmentObjectPath(a.attachmentId) });
        }
        break;
      }
      case "tool/result": {
        const callId = data.toolCallId;
        if (!callId) break;
        const msg = data.message;
        const text = textOfMessage(msg);
        callResult.set(callId, {
          ok: !data.error && !/^Error[:\s]/i.test(text),
          summary: clip(text, 100),
        });
        break;
      }
      case "compaction/prune": {
        digest.compactions.push({
          seq: rec.seq,
          shadowedSeqs: data.shadowedSeqs,
          shadowedTokenCount: data.shadowedTokenCount,
        });
        break;
      }
      default:
        break;
    }
  }

  // 回填工具调用结果状态
  for (const t of digest.toolTrace) {
    const r = callResult.get(t.callId);
    if (r) {
      t.ok = r.ok;
      t.resultDigest = r.summary;
    }
  }

  digest.filesTouched = [...fileMap.values()]
    .map((e) => ({ path: e.path, ops: [...e.ops], lastSeq: e.lastSeq }))
    .sort((a, b) => b.lastSeq - a.lastSeq);

  return digest;
}

// ── 预算裁剪 ──────────────────────────────────────────────────────────

/**
 * 按预算从「最不值钱」开始砍：toolTrace → assistantGist → userIntents。
 * 保留最近 N 条（尾部优先），因为增强最关心"刚才在做什么"。
 */
export function fitBudget(digest, budgetTokens) {
  const rawBudget = Number(budgetTokens);
  // approxTokens 是估算值；小于 64 的预算统一钳制，避免返回无法容纳摘要骨架的结果。
  const budget = Number.isFinite(rawBudget) && rawBudget > 0
    ? Math.max(64, Math.floor(rawBudget))
    : DEFAULTS.budgetTokens;
  const d = {
    ...digest,
    userIntents: [...digest.userIntents],
    assistantGist: [...digest.assistantGist],
    toolTrace: [...digest.toolTrace],
    filesTouched: [...digest.filesTouched],
    attachments: [...digest.attachments],
    compactions: [...digest.compactions],
  };
  const size = () => approxTokens(JSON.stringify(d));
  const trimTail = (arr, keep) => (arr.length > keep ? arr.slice(arr.length - keep) : arr);

  if (size() <= budget) return d;

  // 裁剪顺序按「对增强的价值」从低到高：先牺牲工具流水和文件清单，
  // 最后才动用户意图。每一档都重新测一次，够用就停，避免过度裁剪。
  const steps = [
    () => { d.toolTrace = trimTail(d.toolTrace, 12); },
    () => { d.toolTrace = trimTail(d.toolTrace, 6); },
    () => { d.filesTouched = d.filesTouched.slice(0, 24); },
    () => { d.assistantGist = trimTail(d.assistantGist, 6); },
    () => { d.filesTouched = d.filesTouched.slice(0, 12); },
    () => { d.toolTrace = []; },
    () => { d.userIntents = trimTail(d.userIntents, 16); },
    () => { d.filesTouched = d.filesTouched.slice(0, 6); },
    () => { d.assistantGist = trimTail(d.assistantGist, 3); },
    () => { d.userIntents = trimTail(d.userIntents, 8); },
    () => { d.attachments = d.attachments.slice(0, 6); },
    () => { d.assistantGist = []; },
    () => { d.userIntents = trimTail(d.userIntents, 4); },
    () => { d.filesTouched = d.filesTouched.slice(0, 3); },
    () => { d.userIntents = trimTail(d.userIntents, 1); },
  ];

  for (const step of steps) {
    step();
    if (size() <= budget) return d;
  }

  // 最后兜底：砍掉大块内容与自由文本，但保留体积极小、语义关键的元信息
  // （sessionId / cwd / model / lastSeq），否则返回空壳，调用方无法判断是
  // 「没有上下文」还是「拿到了被裁光的上下文」。
  d.title = null;
  d.startedAt = null;
  d.userIntents = [];
  d.assistantGist = [];
  d.toolTrace = [];
  d.filesTouched = [];
  d.attachments = [];
  d.compactions = [];
  d.shadowedCount = 0;
  d.warnings = [...(d.warnings || []), "digest trimmed to fit budget"];
  return d;
}

/** 把 digest 渲染成可塞进 prompt 的紧凑文本 */
export function renderDigest(digest, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const lines = [];
  const push = (s) => lines.push(s);

  if (digest.title) push(`会话标题：${digest.title}`);
  if (digest.cwd) push(`工作目录：${digest.cwd}`);
  if (digest.model) push(`模型：${digest.model.provider}/${digest.model.model}`);
  if (digest.lastSeq) push(`记录范围：至 seq ${digest.lastSeq}`);
  if (digest.shadowedCount) push(`（其中 ${digest.shadowedCount} 条已被上下文压缩遮蔽）`);

  if (digest.userIntents.length) {
    push("");
    push("用户最近的意图：");
    for (const u of digest.userIntents) push(`- [seq ${u.seq}] ${u.text}`);
  }

  if (digest.assistantGist.length) {
    push("");
    push("助手最近的结论：");
    for (const a of digest.assistantGist) push(`- [seq ${a.seq}] ${a.text}`);
  }

  if (digest.toolTrace.length) {
    push("");
    push("最近的工具动作：");
    for (const t of digest.toolTrace) {
      const flag = t.ok === false ? " ✗" : t.ok === true ? " ✓" : "";
      push(`- ${t.name}${flag} ${t.argsDigest}`);
    }
  }

  if (digest.filesTouched.length) {
    push("");
    push("已触碰的文件：");
    for (const f of digest.filesTouched) push(`- ${f.path}（${f.ops.join("/")}）`);
  }

  if (digest.attachments.length) {
    push("");
    push("会话中的附件：");
    for (const a of digest.attachments) {
      const dim = a.width && a.height ? ` ${a.width}x${a.height}` : "";
      push(`- ${a.name || a.attachmentId} ${a.mediaType || ""}${dim} ${a.bytes || "?"}B`);
    }
  }

  const text = lines.join("\n").trim();
  return opts.redact ? redactText(text, true) : text;
}

// ── 定向读取 ──────────────────────────────────────────────────────────

/**
 * 按 key 取实体内容。四类 key：
 *   attachment:sha256:...   → 对象文件路径 + 元信息（不回 base64）
 *   file:/abs/path          → 文本内容（超限截断）
 *   seq:START-END           → 该 seq 区间的原始记录（需 frames 支持）
 *   call:CALL_ID            → tool/call + 配对 tool/result
 */
export function resolveKey(key, ctx) {
  const s = String(key || "");
  const opts = { ...DEFAULTS, ...(ctx && ctx.options) };

  if (s.startsWith("attachment:")) {
    const id = s.slice("attachment:".length);
    const objectPath = attachmentObjectPath(id);
    if (!objectPath) return { key: s, kind: "error", error: "malformed attachment id" };
    try {
      const st = fs.statSync(objectPath);
      return {
        key: s,
        kind: "binary",
        path: objectPath,
        bytes: st.size,
        truncated: false,
      };
    } catch (e) {
      return { key: s, kind: "error", error: String(e && e.message) };
    }
  }

  if (s.startsWith("file:")) {
    const p = s.slice("file:".length);
    try {
      if (!path.isAbsolute(p)) {
        return { key: s, kind: "error", error: "file path must be absolute" };
      }
      const realPath = fs.realpathSync(p);
      const roots = Array.isArray(ctx && ctx.allowedRoots) ? ctx.allowedRoots : [];
      let allowed = false;
      for (const root of roots) {
        try {
          const realRoot = fs.realpathSync(root);
          const relative = path.relative(realRoot, realPath);
          if (
            relative === "" ||
            (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
          ) {
            allowed = true;
            break;
          }
        } catch {
          // 不存在或不可解析的根目录不授予访问权限
        }
      }
      if (!allowed) {
        return {
          key: s,
          kind: "error",
          error: "file path outside allowed roots or no allowed roots configured",
        };
      }
      const st = fs.statSync(realPath);
      if (!st.isFile()) return { key: s, kind: "error", error: "file path is not a regular file" };
      const limit = Math.min(st.size, opts.fileReadLimit);
      const fd = fs.openSync(realPath, "r");
      const buf = Buffer.alloc(limit);
      let read = 0;
      try {
        read = fs.readSync(fd, buf, 0, limit, 0);
      } finally {
        fs.closeSync(fd);
      }
      let text = buf.subarray(0, read).toString("utf8");
      if (opts.redact) text = redactText(text, true);
      return {
        key: s,
        kind: "text",
        path: realPath,
        bytes: st.size,
        text,
        truncated: st.size > limit,
      };
    } catch (e) {
      return { key: s, kind: "error", error: String(e && e.message) };
    }
  }

  if (s.startsWith("seq:") && ctx && typeof ctx.readSeqRange === "function") {
    const m = /^seq:(\d+)(?:-(\d+))?$/.exec(s);
    if (!m) return { key: s, kind: "error", error: "malformed seq key" };
    const from = Number(m[1]);
    const to = m[2] === undefined ? from : Number(m[2]);
    try {
      const records = ctx.readSeqRange(from, to);
      return {
        key: s,
        kind: "records",
        count: records.length,
        records: records.map((r) => ({
          seq: r.seq,
          type: r.type,
          time: r.time,
          data: slimRecordData(r),
        })),
        truncated: false,
      };
    } catch (e) {
      return { key: s, kind: "error", error: String(e && e.message) };
    }
  }

  if (s.startsWith("call:") && ctx && typeof ctx.findCall === "function") {
    const callId = s.slice("call:".length);
    try {
      const hit = ctx.findCall(callId);
      if (!hit) return { key: s, kind: "error", error: "call not found" };
      return {
        key: s,
        kind: "call",
        callId,
        name: hit.name,
        arguments: hit.arguments,
        result: hit.result,
        truncated: false,
      };
    } catch (e) {
      return { key: s, kind: "error", error: String(e && e.message) };
    }
  }

  return { key: s, kind: "error", error: "unsupported key scheme" };
}

/** 记录瘦身：去掉 stream / replayState / usage 这类大块 */
function slimRecordData(rec) {
  const data = rec && rec.data;
  if (!data || typeof data !== "object") return data;
  const out = { ...data };
  if (out.stream) delete out.stream;
  if (out.message && typeof out.message === "object") {
    const m = { ...out.message };
    if (m.replayState) delete m.replayState;
    if (Array.isArray(m.content)) {
      m.content = m.content.filter((b) => b && b.type !== "reasoning");
    }
    out.message = m;
  }
  if (out.usage) delete out.usage;
  return out;
}

// ── 读取器 ────────────────────────────────────────────────────────────

/**
 * 创建上下文读取器。内部持有 digest 缓存（按文件 revision 失效）。
 *
 * @param {{ root?: string, version?: number, options?: object }} [config]
 */
export function createContextReader(config = {}) {
  const root = config.root || SESSIONS_ROOT;
  const version = config.version || SESSION_FORMAT_VERSION;
  const baseOptions = { ...DEFAULTS, ...(config.options || {}) };

  /** digest 缓存：key = sessionId，value = { rev, digest, stats } */
  const cache = new Map();
  /** 帧级 seq 索引缓存：key = sessionId，value = { rev, index } */
  const seqIndexCache = new Map();

  /**
   * 取（或构建）该会话的帧 seq 边界索引。构建代价 = 解压全部帧一次，
   * 因此按 revision 缓存，且只在真正用到 seq:/call: key 时才触发。
   */
  function frameSeqIndex(sessionId, rev, raw, frames) {
    const hit = seqIndexCache.get(sessionId);
    if (hit && hit.rev === rev) return hit.index;
    const index = buildFrameSeqIndex(raw, frames);
    seqIndexCache.set(sessionId, { rev, index });
    while (seqIndexCache.size > baseOptions.digestCacheEntries) {
      const oldest = seqIndexCache.keys().next().value;
      seqIndexCache.delete(oldest);
    }
    return index;
  }

  function revisionOf(file) {
    const st = fs.statSync(file);
    return [st.dev, st.ino, st.size, st.mtimeNs ?? st.mtimeMs, st.ctimeNs ?? st.ctimeMs].join(":");
  }

  /**
   * 缓存键必须带上 scope：recent 与 full 产出的 digest 内容不同。
   * 缓存里存的是「未按预算裁剪」的原始 digest，命中后再按本次预算裁剪，
   * 否则小预算请求会拿到上一轮大预算的胖结果。
   */
  function cacheKeyOf(sessionId, scope) {
    return `${sessionId}|${scope}`;
  }

  function cacheGet(sessionId, scope, rev) {
    const key = cacheKeyOf(sessionId, scope);
    const hit = cache.get(key);
    if (!hit || hit.rev !== rev) return null;
    // LRU：命中后挪到末尾
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }

  function cachePut(sessionId, scope, rev, value) {
    const key = cacheKeyOf(sessionId, scope);
    cache.set(key, { rev, ...value });
    while (cache.size > baseOptions.digestCacheEntries) {
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
    }
  }

  /** 解首帧拿 header（首帧必然只含一行 header） */
  function readHeader(file) {
    const raw = fs.readFileSync(file);
    const { frames } = scanZstdFrames(raw, 1);
    if (!frames.length) throw new Error("empty zstd session log");
    const lines = decodeFrameLines(raw, frames[0]);
    const header = lines.find((r) => r && r.type === "session");
    if (!header) throw new Error("missing session header frame");
    return { raw, header: header.data || {}, headerRecord: header };
  }

  /**
   * 主入口：读取并产出 digest + 定向读取结果。
   */
  function read(request = {}) {
    const started = Date.now();
    const opts = { ...baseOptions, ...(request.options || {}) };
    const warnings = [];
    const stats = {
      compressedBytes: 0,
      plaintextBytes: 0,
      frames: 0,
      decodedFrames: 0,
      decodeMs: 0,
      budgetUsed: 0,
      cacheHit: false,
    };

    const sessionId = String(request.sessionId || "");
    if (!sessionId) {
      return { ok: false, error: "sessionId is required", warnings: ["missing sessionId"], stats };
    }

    // [1] 定位
    let file = null;
    let cwd = request.cwd;
    if (cwd) {
      const guess = logPath(root, cwd, sessionId, version);
      if (fs.existsSync(guess)) file = guess;
    }
    if (!file) {
      // 未给 cwd 或猜错：扫根下所有 project 目录
      try {
        for (const dir of fs.readdirSync(root)) {
          const candidate = path.join(root, dir, encodeSegment(sessionId), `session.v${version}.jsonl.zstd`);
          if (fs.existsSync(candidate)) {
            file = candidate;
            break;
          }
        }
      } catch (e) {
        warnings.push(`scan sessions root failed: ${String(e && e.message)}`);
      }
    }
    if (!file) {
      return { ok: false, error: `session log not found: ${sessionId}`, warnings, stats };
    }

    try {
      const rev = revisionOf(file);
      const scope = String(request.scope || opts.scope);
      const budget = Number(request.budgetTokens ?? opts.budgetTokens) || opts.budgetTokens;
      const hasKeys = Array.isArray(request.keys) && request.keys.length > 0;

      // 缓存命中：不读文件、不扫帧，但仍要按「本次」预算裁剪
      const hit = cacheGet(sessionId, scope, rev);
      if (hit && !hasKeys) {
        const cached = fitBudget(hit.digest, budget);
        const cachedStats = {
          ...(hit.stats || stats),
          cacheHit: true,
          budgetUsed: approxTokens(JSON.stringify(cached)),
          decodeMs: Date.now() - started,
        };
        warnings.push(...(hit.digest.warnings || []));
        return { ok: true, digest: cached, reads: [], stats: cachedStats, warnings };
      }

      // [2] 帧扫描
      const t0 = Date.now();
      const raw = fs.readFileSync(file);
      const { frames, tornStart, maxFramesReached } = scanZstdFrames(raw);
      stats.compressedBytes = raw.length;
      stats.frames = frames.length;
      if (tornStart !== undefined) warnings.push(`torn final frame at byte ${tornStart} (ignored)`);
      if (maxFramesReached) {
        warnings.push(`frame scan limit reached (${MAX_FRAMES}); session log may be incomplete`);
      }

      // [3] 决定解压哪些帧
      let frameIdx;
      if (scope === "full") {
        frameIdx = frames.map((_, i) => i);
      } else {
        const keep = Math.min(frames.length, opts.maxFramesRecent);
        const idx = new Set();
        // 尾部 N 帧：最近的意图 / 工具 / 文件
        for (let i = Math.max(0, frames.length - keep); i < frames.length; i += 1) idx.add(i);
        // 头部若干帧：header、会话标题、早期附件
        for (let i = 0; i < Math.min(frames.length, opts.headFrames); i += 1) idx.add(i);
        frameIdx = [...idx].sort((a, b) => a - b);
      }

      // [3.1] 解压并收集记录
      const records = [];
      let plaintextBytes = 0;
      for (const i of frameIdx) {
        const frame = frames[i];
        if (!frame) continue;
        try {
          const decoded = decodeFrame(raw, frame);
          plaintextBytes += decoded.plaintextBytes;
          for (const rec of decoded.records) if (rec) records.push(rec);
          stats.decodedFrames += 1;
        } catch (e) {
          warnings.push(`frame ${i} decode failed: ${String(e && e.message)}`);
        }
      }
      stats.decodeMs = Date.now() - t0;
      stats.plaintextBytes = plaintextBytes;

      // [4][5][6] 瘦身 / 折叠 / 抽取
      let digest = digestOf(records, opts);
      if (!digest.cwd && cwd) digest.cwd = cwd;

      // [7] 定向读取需要的上下文
      // 读取白名单：默认只允许会话工作目录。
      // 放开到 $HOME 会把 ~/.dsh/openai-gateway/api-key、~/Library/Keychains 一并暴露，
      // 所以默认保持最紧；需要读插件源码等场景由调用方显式传 options.roots 扩白名单。
      const allowedRoots =
        Array.isArray(opts.roots) && opts.roots.length > 0
          ? opts.roots
          : digest.cwd
            ? [digest.cwd]
            : [];
      const readerCtx = {
        options: opts,
        allowedRoots,
        readSeqRange: (from, to) => {
          // 按 seq 单调性二分帧区间，只解目标帧
          return readSeqRange(sessionId, rev, raw, frames, from, to);
        },
        findCall: (callId) => findCallInLog(raw, frames, callId),
      };
      const reads = [];
      if (Array.isArray(request.keys)) {
        for (const key of request.keys.slice(0, 32)) {
          try {
            reads.push(resolveKey(key, readerCtx));
          } catch (e) {
            reads.push({ key: String(key), kind: "error", error: String(e && e.message) });
          }
        }
      }

      // [8] 预算裁剪 + 脱敏
      // 缓存存「未裁剪」版本（带 warnings），裁剪在返回前做，保证不同预算互不污染
      digest.warnings = [...(digest.warnings || []), ...warnings];
      cachePut(sessionId, scope, rev, { digest, stats: { ...stats } });
      digest = fitBudget(digest, budget);
      stats.budgetUsed = approxTokens(JSON.stringify(digest));

      return {
        ok: true,
        digest,
        reads,
        stats: { ...stats, decodeMs: Date.now() - started },
        warnings,
      };
    } catch (e) {
      return {
        ok: false,
        error: String(e && e.message ? e.message : e),
        warnings,
        stats,
      };
    }
  }

  /**
   * 按 seq 区间取原始记录。
   *
   * seq 在日志里单调递增，且每帧内 seq 连续。这里先给每帧建一条
   * 「首 seq / 末 seq」轻索引（只解一次，且只解析首末行），之后按索引
   * 直接定位目标帧，避免逐帧全解。
   */
  function readSeqRange(sessionId, rev, raw, frames, from, to) {
    if (
      !Number.isSafeInteger(from) || !Number.isSafeInteger(to) ||
      from < 0 || to < from
    ) {
      throw new Error("invalid seq range");
    }
    const MAX_RECORDS = 2000;
    const out = [];
    let index = null;
    try {
      index = frameSeqIndex(sessionId, rev, raw, frames);
    } catch {
      index = null;
    }
    if (index) {
      // 二分找第一个「末 seq >= from」的帧
      let lo = 0;
      let hi = index.length - 1;
      let start = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (index[mid].last >= from) {
          start = mid;
          hi = mid - 1;
        } else {
          lo = mid + 1;
        }
      }
      if (start >= 0) {
        for (let i = start; i < index.length; i += 1) {
          if (index[i].first > to) break;
          try {
            for (const rec of decodeFrameLines(raw, frames[i])) {
              if (rec && typeof rec.seq === "number" && rec.seq >= from && rec.seq <= to) {
                out.push(rec);
                if (out.length >= MAX_RECORDS) return out;
              }
            }
          } catch {
            /* 单帧损坏跳过 */
          }
        }
      }
      return out;
    }
    // 兜底：线性扫描（索引建不起来时）
    for (const frame of frames) {
      try {
        for (const rec of decodeFrameLines(raw, frame)) {
          if (rec && typeof rec.seq === "number" && rec.seq >= from && rec.seq <= to) {
            out.push(rec);
            if (out.length >= MAX_RECORDS) return out;
          }
        }
      } catch {
        /* skip */
      }
    }
    return out;
  }

  /** 在日志里找 callId，返回参数与配对结果 */
  function findCallInLog(raw, frames, callId) {
    let call = null;
    let result = null;
    // callId 当前没有可用的帧级索引，直接线性扫描，避免无效地预解压所有帧建索引。
    for (const frame of frames) {
      let lines;
      try {
        lines = decodeFrameLines(raw, frame);
      } catch {
        continue;
      }
      for (const rec of lines) {
        if (!rec) continue;
        if (rec.type === "assistant/message" && !call) {
          for (const c of toolCallOfMessage(rec.data && rec.data.message)) {
            if (c.callId === callId) call = c;
          }
        } else if (rec.type === "tool/result" && !result) {
          const d = rec.data || {};
          if (d.toolCallId === callId) {
            result = { ok: !d.error, text: clip(textOfMessage(d.message), 400) };
          }
        }
        if (call && result) return { ...call, result };
      }
      if (call && result) break;
    }
    return call ? { ...call, result } : null;
  }

  return {
    read,
    /** 只拿 header，用于「没有 cwd 时先定位」 */
    header(sessionId, cwd) {
      try {
        let file = cwd ? logPath(root, cwd, sessionId, version) : null;
        if (!file || !fs.existsSync(file)) {
          for (const dir of fs.readdirSync(root)) {
            const candidate = path.join(root, dir, encodeSegment(sessionId), `session.v${version}.jsonl.zstd`);
            if (fs.existsSync(candidate)) {
              file = candidate;
              break;
            }
          }
        }
        if (!file) return null;
        const { header } = readHeader(file);
        return { ...header, file };
      } catch {
        return null;
      }
    },
    _internal: { logPath, projectKey, encodeSegment, scanZstdFrames, digestOf, fitBudget },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PART 2 / 2 — HTTP 路由与增强主流程（合并自 lib/index.js）
// ═══════════════════════════════════════════════════════════════════════════

export const name = "dsh-enhance-prompt";
export const inject = ["webServer"];

const ROUTE = "/dsh-enhance-prompt/enhance";
const CONTEXT_ROUTE = "/dsh-enhance-prompt/context";

/** 上下文读取器：进程内单例，自带 digest 缓存 */
let contextReader = null;
function getContextReader() {
  if (!contextReader) {
    try {
      contextReader = createContextReader();
    } catch {
      contextReader = null;
    }
  }
  return contextReader;
}

const SYSTEM_PROMPT = `You are a Prompt Engineering Expert specializing in improving user prompts for a development code assistant. When given a prompt, analyze and enhance it to create a more effective version while maintaining its core purpose.

TASK:
Evaluate the original prompt: identify the main objective, note ambiguities or gaps, check for missing context.
Apply these principles: write clear specific instructions, include necessary context, set explicit parameters and constraints, structure the output format, remove redundant information, match tone and complexity to the use case.
Create the enhanced version: keep the original goal, incorporate the improvements, stay realistic.

Do NOT request guides/how-tos unless the user asks.
Do NOT ask for code snippets.
Do NOT suggest specific technologies unless mentioned in the user's prompt.
Do NOT explain HOW to do things, focus on WHAT.
Do NOT answer questions - expand/rewrite them to be more detailed.

IMPORTANT CONSTRAINTS:
1. Language matching is the highest priority. Respond in the exact same language as the user's input. Never mix languages unless the input itself mixes them.
2. Keep the enhanced prompt concise - maximum length around 800 characters.
3. Output only the enhanced prompt. No preface, no explanation, no markdown fences, no language labels.`;

/**
 * @param {string} input 草稿原文
 * @param {string} [contextBlock] 由 renderDigest 产出的上下文摘要（可选）
 */
function buildUserPrompt(input, contextBlock) {
  const ctxPart = contextBlock
    ? `CONVERSATION CONTEXT (reference only — use it to disambiguate, do NOT answer it):
${contextBlock}

`
    : "";
  return `${ctxPart}USER INPUT:
${input}

TASK:
Rewrite the user input into a clearer, more specific prompt for the target AI assistant.

RULES:
1. Same language as the user input. Chinese in, Chinese out.
2. Output only the enhanced prompt text.
3. Preserve the user's intent, constraints and target output type. Do not answer the request.
4. Always make a substantive improvement; if already clear, polish lightly instead of returning it unchanged.
5. Do not end with an unfinished list, dangling conjunction, or trailing colon.`;
}

/** 消息内容必须是块数组（DSH 的 content block 协议） */
function textBlock(text) {
  return [{ type: "text", text }];
}

/** 剥掉模型可能加的外层包裹引号 / 代码围栏 */
function unwrap(text) {
  let s = String(text || "").trim();
  const fence = s.match(/^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n```$/);
  if (fence) s = fence[1].trim();
  const pairs = [
    ['"', '"'],
    ["'", "'"],
    ["\u201c", "\u201d"],
    ["\u300c", "\u300d"],
    ["\u300e", "\u300f"],
  ];
  for (const [l, r] of pairs) {
    if (s.length > 1 && s.startsWith(l) && s.endsWith(r)) {
      s = s.slice(l.length, s.length - r.length).trim();
      break;
    }
  }
  return s;
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

function readBody(request, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let settled = false;
    const done = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    request.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        // 发布版：不再 destroy 连接（客户端只会看到"网络错误"）。
        // 标记 413 让 handler 回一个可读的 JSON，再结束响应。
        const err = new Error("request body too large");
        err.statusCode = 413;
        done(reject, err);
        return;
      }
      chunks.push(c);
    });
    request.on("end", () => done(resolve, Buffer.concat(chunks).toString("utf8")));
    request.on("error", (e) => done(reject, e));
    // 客户端在读完 body 前断开：必须让 promise 结束，否则 handler 永远挂着
    request.on("close", () => {
      if (!request.complete) done(reject, new Error("client closed connection"));
    });
  });
}

/**
 * 把一个 AbortController 绑到响应上：客户端断开连接时中止上游模型请求。
 *
 * 为什么需要它：`fetch(..., { signal })` 的 abort 只断开浏览器这一侧，
 * 服务端的 `llm.stream()` 不会自己知道。没有这层绑定，用户点「取消」后
 * 模型仍会跑完整个生成过程，token 照扣、免费渠道积分照消耗。
 *
 * @param response 该请求的响应对象
 * @returns 与响应生命周期绑定的 signal
 */
function abortOnDisconnect(response) {
  const controller = new AbortController();
  const onClose = () => {
    // 正常结束时 close 也会触发，那时 writableEnded 为 true，不该 abort
    if (!response.writableEnded) {
      controller.abort(new Error("client disconnected"));
    }
  };
  response.on("close", onClose);
  return controller;
}

/**
 * 从 chunk 流里榨出纯文本（DSH 用 type/text 的 chunk 协议）。
 *
 * 同时捕获 `finish` chunk 里的失败信息 —— DSH 的 adapter 失败不会抛异常，
 * 而是 yield 一个 `{ type: "finish", reason: { kind: "error", failure } }`。
 * 之前完全忽略它，导致所有错误都被压成「empty result」。
 *
 * @returns {{ text: string, failure: string|undefined }}
 */
async function collectStreamText(stream) {
  let out = "";
  let failure;
  if (!stream) return { text: "", failure: "no stream" };
  if (typeof stream === "string") return { text: stream, failure: undefined };

  // 首选：用官方 BlockAssembler 组装，再从 message content 里取 text 块
  let BlockAssembler;
  try {
    ({ BlockAssembler } = await import("@deepseek-ai/dsh-llm"));
  } catch {
    BlockAssembler = undefined;
  }
  const assembler = BlockAssembler ? new BlockAssembler() : undefined;
  let sawChunk = false;

  // 纯文本兜底累积（assembler 不可用时也能拿到结果）
  const plain = (ev) => {
    if (!ev || typeof ev !== "object") return;
    // adapter 失败/中断的终态
    if (ev.type === "finish") {
      const reason = ev.reason;
      if (reason && reason.kind && reason.kind !== "stop" && reason.kind !== "length") {
        const f = reason.failure;
        if (typeof f === "string") {
          failure = f;
        } else if (f && typeof f === "object") {
          failure = [f.code, f.status, f.message].filter(Boolean).join(" / ") || String(reason.kind);
        } else {
          failure = String(reason.kind);
        }
      }
      return;
    }
    if (ev.type === "chunk" && ev.chunk) return plain(ev.chunk);
    if (ev.type === "text-chunks" && Array.isArray(ev.texts)) {
      out += ev.texts.join("");
      return;
    }
    if (ev.type === "text-delta" && typeof ev.text === "string") {
      out += ev.text;
      return;
    }
    if (ev.type === "text" && typeof ev.text === "string") {
      out += ev.text;
      return;
    }
    if (typeof ev.text === "string" && (ev.type === undefined || ev.role === "assistant")) {
      out += ev.text;
    }
  };

  const feed = (ev) => {
    if (!ev || typeof ev !== "object") return;
    // 无论 assembler 是否可用，都先做纯文本累积；finish 只承载终态，不是内容块。
    plain(ev);
    if (!assembler || ev.type === "finish") return;
    // 记录级 { type: "chunk", chunk }
    if (ev.type === "chunk" && ev.chunk && typeof ev.chunk === "object") {
      try {
        assembler.push(ev.chunk);
        sawChunk = true;
      } catch {
        /* ignore malformed chunk */
      }
      return;
    }
    // 块级 chunk
    if (typeof ev.type === "string" && ev.type !== "text-chunks") {
      try {
        assembler.push(ev);
        sawChunk = true;
      } catch {
        /* ignore malformed chunk */
      }
      return;
    }
    // 打包形态 { type: "text-chunks", texts }
    if (ev.type === "text-chunks" && Array.isArray(ev.texts)) {
      const joined = ev.texts.join("");
      if (joined) {
        try {
          assembler.push({ type: "text-delta", index: ev.index ?? 0, text: joined });
          sawChunk = true;
        } catch {
          /* ignore */
        }
      }
    }
  };

  if (typeof stream[Symbol.asyncIterator] === "function") {
    for await (const ev of stream) feed(ev);
  } else if (typeof stream.getReader === "function") {
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      feed(value);
    }
  } else {
    feed(stream);
  }

  if (sawChunk && assembler) {
    try {
      const msg = assembler.message({ provider: "enhance", model: "enhance" });
      const blocks = Array.isArray(msg && msg.content) ? msg.content : [];
      const text = blocks
        .map((b) => (b && b.type === "text" && typeof b.text === "string" ? b.text : ""))
        .join("");
      if (text.trim()) return { text, failure };
    } catch {
      /* 落到兜底 */
    }
    // 兜底：直接用 interruptedBlocks
    try {
      const partial = assembler.interruptedBlocks();
      const text = (Array.isArray(partial) ? partial : [])
        .map((b) => (b && b.type === "text" && typeof b.text === "string" ? b.text : ""))
        .join("");
      if (text.trim()) return { text, failure };
    } catch {
      /* ignore */
    }
  }
  return { text: out, failure };
}


/** 从 profile 的 cordis.patch.yml 里读默认 provider/model（最可靠的兜底） */
async function routeFromProfileConfig() {
  try {
    // 发布版：不写死 profile 名。先试全部 profile，找不到再放弃。
    const profRoot = path.join(os.homedir(), ".dsh", "profiles");
    let text = null;
    try {
      const names = fs.readdirSync(profRoot, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name !== "node_modules")
        .map((d) => d.name);
      // 同 machine 上多个 profile 时，优先 desktop（与自用版行为一致）
      names.sort((a, b) => (a === "desktop" ? -1 : b === "desktop" ? 1 : 0));
      for (const name of names) {
        const cand = path.join(profRoot, name, "cordis.patch.yml");
        try { text = fs.readFileSync(cand, "utf8"); if (text) break; } catch { /* 下一个 */ }
      }
    } catch { /* profiles 根不存在 */ }
    if (!text) return {};
    // 找 agent-default-model 段下的 provider / model
    const block = text.split(/- id:\s*agent-default-model/)[1];
    if (!block) return {};
    const seg = block.split(/- id:/)[0];
    const pm = seg.match(/provider:\s*["']?([^"'#\s]+)/);
    const mm = seg.match(/model:\s*["']?([^"'#\s]+)/);
    if (pm && mm) return { provider: pm[1], model: mm[1] };
  } catch {
    /* ignore */
  }
  return {};
}

/**
 * 增强任务的分层模型路由表。
 *
 * 设计依据：
 *   - 增强是「改写文本」的轻任务，输出上限 800 字符，不需要长上下文推理
 *   - 不同 provider 的延迟差异可达 10 倍以上
 *   - 免费渠道常有积分/配额限制，不适合做高频默认
 *
 * 因此分三层，按「便宜优先」排序，失败自动往上升级：
 *   cheap   —— 免费/低额度渠道，延迟最低，用于日常增强
 *   balanced—— 稳定付费通道，质量与延迟折中
 *   strong  —— profile/宿主默认模型兜底；只有客户端明确传入路由时才能保证使用会话所选模型
 *
 * 每项 { provider, model, label }。不可用的候选会在运行时被跳过。
 */
// 发布版：路由表默认留空，改为从 package.json 的 dsh.enhancePrompt.tiers 读取。
// 不随包内置任何 provider 绑定：不配置时全部档位走宿主默认，
// 开箱即用，也不会去尝试本机不存在的 provider。
let MODEL_TIERS = { cheap: [], balanced: [], strong: [] };
try {
  const pkgPath = path.join(path.dirname(new URL(import.meta.url).pathname), "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const cfg = pkg && pkg.dsh && pkg.dsh.enhancePrompt && pkg.dsh.enhancePrompt.tiers;
  if (cfg && typeof cfg === "object") {
    const pick = (v) => (Array.isArray(v) ? v.filter((x) => x && x.provider && x.model) : []);
    MODEL_TIERS = { cheap: pick(cfg.cheap), balanced: pick(cfg.balanced), strong: [] };
  }
} catch {
  /* 读不到配置就用空表，全部走宿主默认 */
}

/** 解析客户端传来的 tier 名，非法值退回 cheap */
function normalizeTier(value) {
  const t = String(value || "").toLowerCase();
  return Object.prototype.hasOwnProperty.call(MODEL_TIERS, t) ? t : "cheap";
}

/**
 * 按 tier 展开候选列表：tier 自身 + 更高层级兜底，避免首选不可用就整体失败。
 * strong 层由调用方注入 profile/宿主默认路由；它不一定等同于当前会话模型。
 */
function candidatesFor(tier, sessionRoute) {
  const order = { cheap: ["cheap", "balanced", "strong"], balanced: ["balanced", "strong"], strong: ["strong"] };
  const list = [];
  for (const name of order[tier] || order.cheap) {
    if (name === "strong") {
      if (sessionRoute && sessionRoute.provider && sessionRoute.model) {
        list.push({ ...sessionRoute, label: "默认模型兜底" });
      }
      continue;
    }
    list.push(...MODEL_TIERS[name]);
  }
  return list;
}

/** 挑一个可用的 provider/model（客户端没传时兜底） */
async function pickRoute(llm) {
  // 1) 从 profile 默认模型配置读（最准，且能拿到 model）
  const fromProfile = await routeFromProfileConfig();
  if (fromProfile.provider && fromProfile.model) return fromProfile;

  // 2) 退回 listProviders 探测
  try {
    const providers = typeof llm.listProviders === "function"
      ? await Promise.resolve(llm.listProviders())
      : [];
    if (!Array.isArray(providers)) return {};
    for (const p of providers) {
      const id = p && (p.id || p.name);
      if (!id) continue;
      const models = Array.isArray(p.models) ? p.models : [];
      const first = models[0];
      const modelId = first && (typeof first === "string" ? first : first.id);
      if (modelId) return { provider: id, model: modelId };
    }
  } catch {
    /* ignore */
  }
  return {};
}

export function apply(ctx) {
  ctx.inject(["webServer"], (host) => {
    host.effect(() => {
      let disposed = false;

      const off = host.webServer.register(
        {
          kind: "exact",
          path: ROUTE,
          handler: async (request, response) => {
            const method = String(request.method || "").toUpperCase();
            if (method !== "POST") {
              response.writeHead(405, { allow: "POST" });
              response.end();
              return;
            }
            try {
              const raw = await readBody(request);
              let body = {};
              try {
                body = JSON.parse(raw || "{}");
              } catch {
                sendJson(response, 400, { ok: false, error: "invalid JSON body" });
                return;
              }

              const text = String(body.text || "");
              if (!text.trim()) {
                sendJson(response, 400, { ok: false, error: "empty draft" });
                return;
              }

              const llm = ctx.get("llm");
              if (!llm || typeof llm.stream !== "function") {
                sendJson(response, 503, { ok: false, error: "llm service unavailable" });
                return;
              }

              // ── 候选模型列表 ──
              // 优先用客户端显式传入的 provider/model（用户在下拉里选的那个）；
              // 否则按 tier 展开分层候选，逐个试，失败自动升级到下一档。
              const explicitProvider = body.provider ? String(body.provider) : "";
              const explicitModel = body.model ? String(body.model) : "";
              const tier = normalizeTier(body.tier);

              let candidates = [];
              if (explicitProvider && explicitModel) {
                candidates = [{ provider: explicitProvider, model: explicitModel, label: "手动选择" }];
              } else {
                // 无显式手动路由时，将 profile/宿主默认模型作为更高层级的兜底候选。
                // 当前会话模型只有在客户端明确传入 provider + model 时才能确定。
                const defaultRoute = await pickRoute(llm);
                candidates = candidatesFor(tier, defaultRoute);
                if (candidates.length === 0 && defaultRoute.provider && defaultRoute.model) {
                  candidates = [{ ...defaultRoute, label: "profile/宿主默认" }];
                }
              }

              // 发布版兜底：读不到任何 profile 默认路由时，不指定 provider，
              // 让宿主用自己当前的默认模型。避免"没配置就完全不可用"。
              if (candidates.length === 0) {
                candidates = [{ provider: undefined, model: undefined, label: "宿主默认（未指定）" }];
              }

              // 可选：从会话日志读上下文摘要，拼进 user prompt。
              // 失败一律降级为「无上下文」，绝不影响增强主流程。
              let contextBlock = "";
              let contextStats = null;
              const ctxReq = body.context;
              if (ctxReq && typeof ctxReq === "object" && ctxReq.sessionId) {
                try {
                  const reader = getContextReader();
                  if (reader) {
                    const got = reader.read({
                      sessionId: String(ctxReq.sessionId),
                      cwd: ctxReq.cwd ? String(ctxReq.cwd) : undefined,
                      scope: ctxReq.scope ? String(ctxReq.scope) : undefined,
                      budgetTokens: Number(ctxReq.budgetTokens) || 1200,
                      keys: Array.isArray(ctxReq.keys) ? ctxReq.keys : undefined,
                    });
                    if (got && got.ok && got.digest) {
                      contextBlock = renderDigest(got.digest);
                      contextStats = got.stats;
                    }
                  }
                } catch {
                  contextBlock = "";
                }
              }

              const messages = [
                { role: "system", content: textBlock(SYSTEM_PROMPT) },
                { role: "user", content: textBlock(buildUserPrompt(text, contextBlock)) },
              ];

              // 客户端断开 → 中止上游模型请求，避免「取消」后仍在计费
              const abortCtl = abortOnDisconnect(response);
              const signal = abortCtl.signal;

              // ── 依次尝试候选，第一个成功即返回 ──
              // 失败原因全部记录下来，最终一起回给客户端，便于判断是配额、
              // 路由还是模型本身的问题（此前被压成一句 empty result）。
              const attempts = [];
              let enhanced = "";
              let used = null;

              for (const cand of candidates) {
                if (disposed) return;
                // 已取消：不再尝试后续候选，否则取消后还会额外多扣一次
                if (signal.aborted) {
                  attempts.push({ ...cand, ok: false, error: "aborted before dispatch" });
                  break;
                }
                const options = {
                  ...(cand.provider ? { provider: cand.provider } : {}),
                  ...(cand.model ? { model: cand.model } : {}),
                  messages,
                  temperature: 0.3,
                  signal,
                };
                if (body.effort) options.reasoningEffort = String(body.effort);

                try {
                  const stream = await llm.stream(options);
                  const { text: collected, failure } = await collectStreamText(stream);
                  const candidateText = unwrap(collected);

                  if (failure) {
                    attempts.push({ ...cand, ok: false, error: failure });
                    if (signal.aborted) break;
                    continue;
                  }
                  if (candidateText) {
                    enhanced = candidateText;
                    used = cand;
                    attempts.push({ ...cand, ok: true });
                    break;
                  }
                  attempts.push({ ...cand, ok: false, error: "empty result" });
                } catch (e) {
                  attempts.push({
                    ...cand,
                    ok: false,
                    error: String((e && e.message) || e),
                  });
                }
              }

              if (disposed) return;
              // 客户端已断开：不再写响应（socket 已关，写了也无意义）
              if (signal.aborted) return;
              if (!enhanced) {
                sendJson(response, 502, {
                  ok: false,
                  error: "all candidate models failed",
                  attempts,
                });
                return;
              }
              sendJson(response, 200, {
                ok: true,
                text: enhanced,
                model: used ? { provider: used.provider, model: used.model } : undefined,
                tier,
                attempts,
                ...(contextStats ? { context: contextStats } : {}),
              });
            } catch (e) {
              try {
                if (!response.writableEnded) {
                  // readBody 的 413 等语义错误原样透出，其余归为 500
                  const status = e && e.statusCode ? e.statusCode : 500;
                  sendJson(response, status, {
                    ok: false,
                    error: String(e && e.message ? e.message : e),
                  });
                }
              } catch {
                /* response already closed */
              }
            }
          },
        },
        "dsh-enhance-prompt: enhance"
      );
      // ── 独立上下文端点：POST /dsh-enhance-prompt/context ──
      const offContext = host.webServer.register(
        {
          kind: "exact",
          path: CONTEXT_ROUTE,
          handler: async (request, response) => {
            const method = String(request.method || "").toUpperCase();
            if (method !== "POST") {
              response.writeHead(405, { allow: "POST" });
              response.end();
              return;
            }
            try {
              const raw = await readBody(request);
              let body = {};
              try {
                body = JSON.parse(raw || "{}");
              } catch {
                sendJson(response, 400, { ok: false, error: "invalid JSON body" });
                return;
              }

              const sessionId = String(body.sessionId || "");
              if (!sessionId) {
                sendJson(response, 400, { ok: false, error: "sessionId is required" });
                return;
              }

              const reader = getContextReader();
              if (!reader) {
                sendJson(response, 503, { ok: false, error: "context reader unavailable" });
                return;
              }

              const redact = body.redact !== false;
              // roots 是可选扩白名单：不传时读取范围只限会话 cwd。
              const roots = Array.isArray(body.roots)
                ? body.roots.filter((r) => typeof r === "string" && r)
                : undefined;
              const result = reader.read({
                sessionId,
                cwd: body.cwd ? String(body.cwd) : undefined,
                scope: body.scope ? String(body.scope) : undefined,
                budgetTokens: Number(body.budgetTokens) || undefined,
                keys: Array.isArray(body.keys) ? body.keys : undefined,
                options: roots ? { redact, roots } : { redact },
              });

              if (!result.ok) {
                sendJson(response, 200, result); // 语义失败也返回 200，便于前端统一处理
                return;
              }

              // 附带一份渲染好的文本，方便直接贴进 prompt / 人眼查看
              let rendered = "";
              try {
                rendered = renderDigest(result.digest, { redact });
              } catch {
                rendered = "";
              }

              const payload = { ...result, rendered };
              sendJson(response, 200, redact ? redactOutput(payload, true) : payload);
            } catch (e) {
              try {
                // readBody 的 413 等语义错误原样透出，其余归为 500
                const status = e && e.statusCode ? e.statusCode : 500;
                sendJson(response, status, {
                  ok: false,
                  error: String(e && e.message ? e.message : e),
                });
              } catch {
                /* response already closed */
              }
            }
          },
        },
        "dsh-enhance-prompt: context"
      );

      return () => {
        disposed = true;
        for (const fn of [off, offContext]) {
          if (typeof fn === "function") {
            try {
              fn();
            } catch {
              /* ignore */
            }
          }
        }
      };
    }, "dsh-enhance-prompt: http route");
  });
}
