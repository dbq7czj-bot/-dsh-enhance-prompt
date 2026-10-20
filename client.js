window.__ModuleLoader__.load({
  id: "dsh-enhance-prompt",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    const React = require("react");
    const h = React.createElement;
    const { useState, useRef, useCallback, useEffect } = React;

    const NS = "dsh-enhance-prompt";
    const ENDPOINT = "/dsh-enhance-prompt/enhance";

    // ---------- 三态图标 ----------
    /**
     * 简约四角星（sparkle）—— 增强/润色的通用语义符号。
     * 单一闭合路径 + 统一 1.5 线宽，14px 下仍清晰；跟随 currentColor 适配深浅背景。
     */
    function IconWand() {
      return h(
        "svg",
        {
          viewBox: "0 0 24 24",
          width: 14,
          height: 14,
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.5,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          "aria-hidden": true,
          style: { display: "block" },
        },
        h("path", {
          d: "M12 3c.55 3.9 1.9 5.25 5.8 5.8-3.9.55-5.25 1.9-5.8 5.8-.55-3.9-1.9-5.25-5.8-5.8C10.1 8.25 11.45 6.9 12 3Z",
        }),
        h("path", {
          d: "M18.5 15.5c.27 1.9.93 2.56 2.83 2.83-1.9.27-2.56.93-2.83 2.83-.27-1.9-.93-2.56-2.83-2.83 1.9-.27 2.56-.93 2.83-2.83Z",
        })
      );
    }

    function IconSpinner() {
      return h(
        "svg",
        {
          viewBox: "0 0 24 24",
          width: 15,
          height: 15,
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 2,
          strokeLinecap: "round",
          "aria-hidden": true,
          style: { animation: "dsh-enhance-spin 0.9s linear infinite" },
        },
        h("path", { d: "M12 3a9 9 0 1 0 9 9" })
      );
    }

    function IconUndo() {
      return h(
        "svg",
        {
          viewBox: "0 0 24 24",
          width: 15,
          height: 15,
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.8,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          "aria-hidden": true,
        },
        h("path", { d: "M3 7v6h6" }),
        h("path", { d: "M3.5 13a9 9 0 1 0 2.6-8.4L3 7" })
      );
    }

    /** 第三拍用：重做箭头，表示「再看一次上次的增强结果」 */
    function IconRedo() {
      return h(
        "svg",
        {
          viewBox: "0 0 24 24",
          width: 15,
          height: 15,
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.8,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          "aria-hidden": true,
        },
        h("path", { d: "M21 7v6h-6" }),
        h("path", { d: "M20.5 13a9 9 0 1 1-2.6-8.4L21 7" })
      );
    }

    function ensureKeyframes() {
      if (typeof document === "undefined") return;
      const id = "dsh-enhance-prompt-style";
      if (document.getElementById(id)) return;
      const style = document.createElement("style");
      style.id = id;
      style.textContent =
        "@keyframes dsh-enhance-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}";
      document.head.appendChild(style);
    }

    /** 从 input 快照里取纯文本草稿（字段是 .draft） */
    function pickDraft(input) {
      if (!input) return "";
      if (typeof input === "string") return input;
      if (typeof input.draft === "string") return input.draft;
      if (typeof input.text === "string") return input.text;
      if (Array.isArray(input.blocks)) {
        return input.blocks
          .filter((b) => !b || b.kind === undefined || b.kind === "text")
          .map((b) => (typeof b === "string" ? b : typeof b?.text === "string" ? b.text : ""))
          .join("");
      }
      return "";
    }

    /**
     * 上下文开关小胶囊。默认关；开时把会话摘要一并交给增强模型。
     * props: on, onToggle, disabled
     */
    function ContextChip(props) {
      const { on, onToggle, disabled } = props || {};
      const [hover, setHover] = useState(false);
      const active = !!on && !disabled;
      return h(
        "button",
        {
          type: "button",
          onClick: (ev) => {
            ev.stopPropagation();
            if (disabled) return;
            if (typeof onToggle === "function") onToggle(!on);
          },
          title: disabled
            ? "当前会话不可用，无法读取上下文"
            : on
              ? "上下文增强：开（点击关闭）"
              : "上下文增强：关（点击开启，会把本会话摘要一并交给模型）",
          "aria-label": "上下文增强开关",
          "aria-pressed": active,
          onMouseEnter: () => setHover(true),
          onMouseLeave: () => setHover(false),
          style: {
            display: "inline-flex",
            alignItems: "center",
            gap: 3,
            height: 22,
            padding: "0 6px",
            border: "none",
            outline: "none",
            borderRadius: 11,
            background: active
              ? "rgba(10,132,255,0.16)"
              : hover
                ? "var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.10))"
                : "transparent",
            color: active
              ? "var(--dsw-alias-label-accent, #0a84ff)"
              : "var(--dsw-alias-label-tertiary, #8e8e93)",
            cursor: disabled ? "default" : "pointer",
            opacity: disabled ? 0.45 : 1,
            font: "inherit",
            fontSize: 11,
            lineHeight: 1,
            userSelect: "none",
            WebkitTapHighlightColor: "transparent",
            transition: "background-color 140ms ease, color 140ms ease",
          },
        },
        h(
          "svg",
          {
            viewBox: "0 0 24 24",
            width: 11,
            height: 11,
            fill: "none",
            stroke: "currentColor",
            strokeWidth: 2,
            strokeLinecap: "round",
            strokeLinejoin: "round",
            "aria-hidden": true,
            style: { display: "block" },
          },
          h("path", { d: "M4 7h16" }),
          h("path", { d: "M4 12h10" }),
          h("path", { d: "M4 17h6" })
        ),
        h("span", null, active ? "上下文" : "上下文")
      );
    }

    /**
     * 魔棒按钮（三态）。
     * props: inputActions, draftText, route
     */
    function EnhanceButton(props) {
      const { inputActions, draftText, route, directory, sessionId } = props || {};
      // ── 三拍循环 ──
      // 循环位置由 step 单独记录（0→1→2→0…），phase 只负责「当前显示什么」。
      // 两者必须分开：第 1 拍结束和第 3 拍结束时显示的都是增强结果，
      // 仅凭 phase 无法判断下一次该走哪一拍。
      //   step 0：idle     —— 显示原文，点击调模型（或命中缓存）生成增强结果 → step 1
      //   step 1：done     —— 显示增强结果，点击显示原文，不调模型           → step 2
      //   step 2：restored —— 显示原文，点击再显示增强结果，不调模型         → step 0
      const [step, setStep] = useState(0);
      const [phase, setPhase] = useState("idle"); // idle | running | done | restored
      const [error, setError] = useState("");
      const abortRef = useRef(null);
      const snapRef = useRef({ before: "", after: "" });
      // 记录本次实际命中的模型（分层路由可能换掉首选）
      const usedRef = useRef(null);
      /**
       * 增强结果缓存。只在两种情况下失效：
       *   1) 用户换了增强所用模型（modelKey 变化）
       *   2) 用户手动改了草稿，或草稿被别处重写（原文对不上）
       * 其余情况（第二、三次点击）一律复用，绝不重复请求大模型。
       */
      const cacheRef = useRef({ modelKey: null, before: "", after: "" });
      // 悬停/按下视觉反馈（必须在任何 early return 之前声明）
      const [hover, setHover] = useState(false);
      const [press, setPress] = useState(false);
      // 模型选择：直接订阅 DSH 模型目录（与模型选择器同源）
      const [menuOpen, setMenuOpen] = useState(false);
      const [picked, setPicked] = useState(null); // { provider, model } | null = 跟随会话
      // 上下文增强开关：默认关（不改变既有增强行为），开后才把会话摘要带给模型
      const [useContext, setUseContext] = useState(false);
      // 省 token 档位：cheap（免费优先）/ balanced（稳定付费）/ strong（会话模型）
      // 持久化到 localStorage，避免每次开面板都要重选
      const [tier, setTier] = useState(() => {
        try {
          const v = window.localStorage.getItem("dsh-enhance-prompt:tier");
          return v === "balanced" || v === "strong" ? v : "cheap";
        } catch {
          return "cheap";
        }
      });
      const pickTier = useCallback((next) => {
        setTier(next);
        try {
          window.localStorage.setItem("dsh-enhance-prompt:tier", next);
        } catch {
          /* 隐私模式下 localStorage 可能不可用 */
        }
      }, []);

      const subscribeDir = useCallback(
        (listener) => {
          if (!directory || typeof directory.subscribe !== "function") return () => {};
          return directory.subscribe(listener);
        },
        [directory]
      );
      const snapshotDir = useCallback(() => {
        if (!directory || typeof directory.getSnapshot !== "function") return null;
        return directory.getSnapshot();
      }, [directory]);

      let dirState = null;
      try {
        dirState = React.useSyncExternalStore(subscribeDir, snapshotDir, snapshotDir);
      } catch {
        dirState = null;
      }

      // 展平成菜单项（保持目录顺序，仅取有模型的组）
      const modelGroups = (() => {
        const groups = (dirState && Array.isArray(dirState.groups)) ? dirState.groups : [];
        return groups
          .filter((g) => g && Array.isArray(g.models) && g.models.length > 0)
          .map((g) => ({
            id: g.id,
            name: g.name || g.id,
            models: g.models.map((m) => ({
              id: m.id,
              name: m.name || m.displayName || m.id,
            })),
          }));
      })();

      const currentSel = (dirState && dirState.current) || route || null;
      const active = picked || currentSel;

      /**
       * 当前「增强效果所用模型」的稳定标识，用作缓存失效依据。
       *   - 手动选了模型：provider/model 拼起来
       *   - 没手动选：用 tier（走分层路由，实际命中的模型可能变，但对用户而言
       *     只要档位没变就算同一个选择，避免路由内部的自动升级导致缓存反复失效）
       * 换档位或换具体模型 → 标识变化 → 下一次增强必然重新生成。
       */
      const modelKey = picked
        ? `pick:${picked.provider || ""}/${picked.model || ""}`
        : `tier:${tier}`;

      /**
       * 模型一变，缓存立刻作废，并把循环重置回起点。
       * 否则用户停在第 3 拍时换模型，下一次点击会读到旧模型的缓存结果，
       * 违背「换模型必须重新生成」的要求。
       */
      useEffect(() => {
        const c = cacheRef.current;
        if (c && c.after && c.modelKey !== modelKey) {
          cacheRef.current = { modelKey: null, before: "", after: "" };
          setPhase("idle");
          setStep(0);
        }
      }, [modelKey]);

      useEffect(() => {
        ensureKeyframes();
      }, []);

      const text = typeof draftText === "string" ? draftText : "";

      // 草稿被改过（手动编辑 / 外部写入）→ 当前显示不再是插件放进去的内容，
      // 整个三拍循环回到起点，缓存也一并作废（原文已变，旧结果不再对应）。
      useEffect(() => {
        const inLoop = phase === "done" || phase === "restored";
        if (!inLoop) return;
        const expected =
          phase === "done" ? snapRef.current.after : snapRef.current.before;
        if (text !== expected) {
          setPhase("idle");
          setStep(0);
          setError("");
          cacheRef.current = { modelKey: null, before: "", after: "" };
        }
      }, [text, phase]);

      const cancel = useCallback(() => {
        if (abortRef.current) {
          try {
            abortRef.current.abort();
          } catch {
            /* ignore */
          }
          abortRef.current = null;
        }
        setPhase("idle");
        setStep(0);
      }, []);

      const run = useCallback(async () => {
        const original = text;
        if (!original.trim()) return;

        // ── 缓存命中：同一个模型 + 同一份原文 → 直接复用，不请求大模型 ──
        const cached = cacheRef.current;
        if (
          cached &&
          cached.after &&
          cached.modelKey === modelKey &&
          cached.before === original
        ) {
          snapRef.current = { before: cached.before, after: cached.after };
          if (inputActions && typeof inputActions.setDraft === "function") {
            inputActions.setDraft(cached.after);
            if (typeof inputActions.persistDraft === "function") {
              try {
                inputActions.persistDraft();
              } catch {
                /* ignore */
              }
            }
          }
          setError("");
          setPhase("done");
          setStep(1);
          return;
        }

        if (abortRef.current) {
          try {
            abortRef.current.abort();
          } catch {
            /* ignore */
          }
        }
        const controller = new AbortController();
        abortRef.current = controller;
        setError("");
        setPhase("running");

        try {
          const resp = await fetch(ENDPOINT, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              text: original,
              // 只有用户在菜单里显式挑了模型，才把它作为「手动选择」锁死发给服务端。
              // 未手动选（picked 为 null）时必须不带 provider/model，否则服务端会走
              // 显式分支而把 tier 整个忽略，分层路由就永久失效。
              provider: picked && picked.provider ? picked.provider : undefined,
              model: picked && picked.model ? picked.model : undefined,
              effort: (active && (active.effort || active.reasoningEffort)) || undefined,
              // 未手动选模型时，服务端按 tier 展开候选并逐个尝试
              tier: picked ? undefined : tier,
              // 只有显式开启且拿到 sessionId 时才带上下文
              context:
                useContext && sessionId
                  ? { sessionId, budgetTokens: 1200 }
                  : undefined,
            }),
            signal: controller.signal,
            cache: "no-store",
            credentials: "same-origin",
          });
          const data = await resp.json().catch(() => null);
          if (controller.signal.aborted) return;

          if (!resp.ok || !data || !data.ok || !String(data.text || "").trim()) {
            // 把每个候选的失败原因拼出来，否则永远只看到一句笼统错误
            let reason = (data && data.error) || `${resp.status} ${resp.statusText}`;
            if (data && Array.isArray(data.attempts) && data.attempts.length > 0) {
              const detail = data.attempts
                .map((a) => `${a.provider}/${a.model || "?"}: ${a.error || "失败"}`)
                .join("；");
              reason = `${reason}（${detail}）`;
            }
            setError(String(reason));
            setPhase("idle"); // 失败：草稿保持原样
            return;
          }

          const enhanced = String(data.text).trim();
          snapRef.current = { before: original, after: enhanced };
          if (data.model) usedRef.current = data.model;
          // 写入缓存：记下这次用的是哪个模型标识，供后续点击直接复用
          cacheRef.current = {
            modelKey,
            before: original,
            after: enhanced,
          };

          if (inputActions && typeof inputActions.setDraft === "function") {
            inputActions.setDraft(enhanced);
            if (typeof inputActions.persistDraft === "function") {
              try {
                inputActions.persistDraft();
              } catch {
                /* ignore */
              }
            }
          }
          setPhase("done");
          setStep(1);
        } catch (e) {
          if (controller.signal.aborted) return;
          setError(String((e && e.message) || e));
          setPhase("idle"); // 失败：草稿保持原样
        } finally {
          if (abortRef.current === controller) abortRef.current = null;
        }
      }, [text, inputActions, active, useContext, sessionId, tier, picked, modelKey]);

      /** 把指定内容写回输入框（不触碰缓存） */
      const applyDraft = useCallback(
        (value) => {
          if (inputActions && typeof inputActions.setDraft === "function") {
            try {
              inputActions.setDraft(value);
              if (typeof inputActions.persistDraft === "function") inputActions.persistDraft();
            } catch {
              /* ignore */
            }
          }
        },
        [inputActions]
      );

      /** 第 2 拍：显示最初的原文。不调模型，缓存保留。 */
      const restore = useCallback(() => {
        applyDraft(snapRef.current.before);
        setPhase("restored");
        setStep(2);
        setError("");
      }, [applyDraft]);

      /** 第 3 拍：再次显示上次的增强结果。不调模型，直接读缓存。 */
      const showEnhanced = useCallback(() => {
        const cached = cacheRef.current;
        const after = (cached && cached.after) || snapRef.current.after;
        if (!after) {
          // 缓存意外缺失（例如页面刷新后 ref 丢失）：退回起点重新生成
          setPhase("idle");
          setStep(0);
          return;
        }
        applyDraft(after);
        setPhase("done");
        setStep(1); // 显示增强结果 → 下一次点击回到第 2 拍（显示原文）
        setError("");
      }, [applyDraft]);

      // 草稿为空 -> 不显示
      if (!text.trim()) return null;

      const onClick = () => {
        if (phase === "running") return cancel();
        // 按 step 决定走哪一拍。
        //   0 → 生成（可能命中缓存，也可能真的调模型），之后 step=1
        //   1 → 显示原文，不调模型，之后 step=2
        //   2 → 显示增强结果，不调模型，之后 step=1（回到第 1 拍位置）
        if (step === 1) return restore();
        if (step === 2) return showEnhanced();
        return run();
      };

      const label =
        phase === "running"
          ? "增强中…（点击取消）"
          : phase === "done"
            ? "已增强（点击还原原文）"
            : phase === "restored"
              ? "已还原（点击再看增强结果）"
              : "增强提示词";
      const title = error ? `${label}\n失败：${error}` : label;

      // ---- 苹果风格：圆形图标按钮 + 毛玻璃 + 悬停/按下反馈 ----
      const SIZE = 28;
      const isDone = phase === "done";
      const isRestored = phase === "restored";
      const isRunning = phase === "running";

      const bg = error
        ? "rgba(255,69,58,0.12)"
        : isDone
          ? "rgba(10,132,255,0.12)"
          : isRestored
            ? "rgba(142,142,147,0.12)"
            : hover
              ? "var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.09))"
              : "transparent";

      const fg = error
        ? "var(--dsw-alias-label-danger, #ff453a)"
        : isDone
          ? "var(--dsw-alias-label-accent, #0a84ff)"
          : isRestored
            ? "var(--dsw-alias-label-secondary, #aeaeb2)"
            : hover
              ? "var(--dsw-alias-label-primary, #f5f5f7)"
              : "var(--dsw-alias-label-tertiary, #8e8e93)";

      const TIER_LABEL = { cheap: "省 token", balanced: "平衡", strong: "最强" };
      const currentLabel = (() => {
        // 未手动选模型时显示档位，而不是会话模型（避免误解为固定用那个）
        if (!picked) return TIER_LABEL[tier] || "省 token";
        if (!active || !active.model) return "";
        for (const g of modelGroups) {
          const hit = g.models.find((m) => m.id === active.model);
          if (hit) return hit.name;
        }
        return active.model;
      })();

      const modelChip =
        modelGroups.length > 0
          ? h(
              "div",
              { style: { position: "relative", display: "inline-flex" } },
              h(
                "button",
                {
                  type: "button",
                  onClick: (ev) => {
                    ev.stopPropagation();
                    setMenuOpen((v) => !v);
                  },
                  title: `增强所用模型：${currentLabel}`,
                  "aria-label": `选择增强模型（当前 ${currentLabel}）`,
                  style: {
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 3,
                    height: 22,
                    maxWidth: 118,
                    padding: "0 6px",
                    border: "none",
                    outline: "none",
                    borderRadius: 11,
                    background: menuOpen
                      ? "var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.10))"
                      : "transparent",
                    color: "var(--dsw-alias-label-tertiary, #8e8e93)",
                    cursor: "pointer",
                    font: "inherit",
                    fontSize: 11,
                    lineHeight: 1,
                    userSelect: "none",
                    WebkitTapHighlightColor: "transparent",
                    transition: "background-color 140ms ease",
                  },
                },
                h(
                  "span",
                  {
                    style: {
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    },
                  },
                  currentLabel
                ),
                h(
                  "svg",
                  {
                    viewBox: "0 0 24 24",
                    width: 9,
                    height: 9,
                    fill: "none",
                    stroke: "currentColor",
                    strokeWidth: 2.4,
                    strokeLinecap: "round",
                    strokeLinejoin: "round",
                    "aria-hidden": true,
                    style: {
                      flex: "0 0 auto",
                      transform: menuOpen ? "rotate(180deg)" : "none",
                      transition: "transform 140ms ease",
                    },
                  },
                  h("path", { d: "M6 9l6 6 6-6" })
                )
              ),
              menuOpen
                ? h(
                    "div",
                    {
                      style: {
                        position: "absolute",
                        bottom: "calc(100% + 6px)",
                        left: 0,
                        minWidth: 176,
                        maxHeight: 264,
                        overflowY: "auto",
                        padding: 4,
                        borderRadius: 10,
                        border: "0.5px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.12))",
                        background: "var(--dsw-alias-bg-elevated, #2c2c2e)",
                        boxShadow: "0 8px 28px rgba(0,0,0,0.36)",
                        backdropFilter: "saturate(180%) blur(20px)",
                        WebkitBackdropFilter: "saturate(180%) blur(20px)",
                        zIndex: 30,
                      },
                    },
                    // ── 省 token 档位选择 ──
                    h(
                      "div",
                      {
                        key: "__tier_header__",
                        style: {
                          padding: "6px 8px 3px",
                          fontSize: 10,
                          lineHeight: 1.2,
                          color: "var(--dsw-alias-label-tertiary, #8e8e93)",
                          userSelect: "none",
                        },
                      },
                      "省 token 档位"
                    ),
                    ...[
                      { id: "cheap", name: "省 token（免费优先）" },
                      { id: "balanced", name: "平衡（稳定付费线）" },
                      { id: "strong", name: "最强（跟随会话模型）" },
                    ].map((t) =>
                      h(
                        "button",
                        {
                          key: "tier_" + t.id,
                          type: "button",
                          onClick: (ev) => {
                            ev.stopPropagation();
                            pickTier(t.id);
                            setPicked(null); // 选档位即放弃手动模型
                            setMenuOpen(false);
                          },
                          style: {
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            width: "100%",
                            padding: "6px 8px",
                            border: "none",
                            outline: "none",
                            borderRadius: 6,
                            background:
                              !picked && tier === t.id
                                ? "var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.10))"
                                : "transparent",
                            color:
                              !picked && tier === t.id
                                ? "var(--dsw-alias-label-accent, #0a84ff)"
                                : "var(--dsw-alias-label-primary, #f5f5f7)",
                            cursor: "pointer",
                            font: "inherit",
                            fontSize: 12,
                            lineHeight: 1.35,
                            textAlign: "left",
                            userSelect: "none",
                          },
                        },
                        h(
                          "span",
                          {
                            style: {
                              flex: "0 0 12px",
                              fontSize: 11,
                              opacity: !picked && tier === t.id ? 1 : 0,
                            },
                          },
                          "✓"
                        ),
                        h("span", { style: { flex: "1", minWidth: 0 } }, t.name)
                      )
                    ),
                    // 分隔
                    h("div", {
                      key: "__sep__",
                      style: {
                        height: 1,
                        margin: "4px 6px",
                        background: "var(--dsw-alias-border-l2, rgba(255,255,255,0.10))",
                      },
                    }),
                    // “跟随当前会话”入口
                    h(
                      "button",
                      {
                        key: "__follow__",
                        type: "button",
                        onClick: (ev) => {
                          ev.stopPropagation();
                          setPicked(null);
                          pickTier("strong"); // 跟随会话 = 用当前会话模型
                          setMenuOpen(false);
                        },
                        style: {
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          width: "100%",
                          padding: "6px 8px",
                          border: "none",
                          outline: "none",
                          borderRadius: 6,
                          background: !picked && tier === "strong"
                            ? "var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.10))"
                            : "transparent",
                          color: !picked && tier === "strong"
                            ? "var(--dsw-alias-label-accent, #0a84ff)"
                            : "var(--dsw-alias-label-primary, #f5f5f7)",
                          cursor: "pointer",
                          font: "inherit",
                          fontSize: 12,
                          lineHeight: 1.35,
                          textAlign: "left",
                          userSelect: "none",
                        },
                      },
                      h("span", { style: { flex: "0 0 12px", fontSize: 11, opacity: !picked ? 1 : 0 } }, "✓"),
                      h("span", { style: { flex: "1" } }, "跟随当前会话")
                    ),
                    ...modelGroups.flatMap((g) => [
                      h(
                        "div",
                        {
                          key: "g_" + g.id,
                          style: {
                            padding: "6px 8px 3px",
                            fontSize: 10,
                            lineHeight: 1.2,
                            color: "var(--dsw-alias-label-tertiary, #8e8e93)",
                            userSelect: "none",
                          },
                        },
                        g.name
                      ),
                      ...g.models.map((m) =>
                        h(
                          "button",
                          {
                            key: g.id + "::" + m.id,
                            type: "button",
                            onClick: (ev) => {
                              ev.stopPropagation();
                              setPicked({ provider: g.id, model: m.id });
                              setMenuOpen(false);
                            },
                          style: {
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            width: "100%",
                            padding: "6px 8px",
                            border: "none",
                            outline: "none",
                            borderRadius: 6,
                            background:
                              active && active.model === m.id && active.provider === g.id
                                ? "var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.10))"
                                : "transparent",
                            color:
                              active && active.model === m.id && active.provider === g.id
                                ? "var(--dsw-alias-label-accent, #0a84ff)"
                                : "var(--dsw-alias-label-primary, #f5f5f7)",
                            cursor: "pointer",
                            font: "inherit",
                            fontSize: 12,
                            lineHeight: 1.35,
                            textAlign: "left",
                            userSelect: "none",
                          },
                        },
                            h("span", {
                              style: {
                                flex: "0 0 12px",
                                fontSize: 11,
                                opacity: active && active.model === m.id && active.provider === g.id ? 1 : 0,
                              },
                            }, "✓"),
                            h("span", { style: { flex: "1", minWidth: 0 } }, m.name)
                          )
                        )
                    ])
                  )
                : null
            )
          : null;

      return h(
        "div",
        {
          style: {
            display: "inline-flex",
            alignItems: "center",
            gap: 2,
            marginLeft: "auto",
            flex: "0 0 auto",
          },
        },
        h(ContextChip, {
          on: useContext,
          disabled: !sessionId,
          onToggle: setUseContext,
        }),
        modelChip,
        h(
        "button",
        {
          type: "button",
          onClick,
          title,
          "aria-label": label,
          "data-phase": phase,
          onMouseEnter: () => setHover(true),
          onMouseLeave: () => {
            setHover(false);
            setPress(false);
          },
          onMouseDown: () => setPress(true),
          onMouseUp: () => setPress(false),
          style: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: SIZE,
            height: SIZE,
            // 视觉上贴进输入框内部
            marginLeft: "auto",
            marginRight: 2,
            padding: 0,
            marginBottom: 0,
            flex: "0 0 auto",
            border: "none",
            outline: "none",
            borderRadius: "50%",
            background: bg,
            color: fg,
            cursor: isRunning ? "progress" : "pointer",
            userSelect: "none",
            font: "inherit",
            // 毛玻璃 + 过渡
            backdropFilter: "saturate(180%) blur(20px)",
            WebkitBackdropFilter: "saturate(180%) blur(20px)",
            boxShadow: hover && !isDone && !error ? "0 0 0 0.5px rgba(255,255,255,0.08) inset" : "none",
            transform: press ? "scale(0.92)" : "scale(1)",
            transition:
              "transform 120ms cubic-bezier(0.4,0,0.2,1), background-color 160ms ease, color 160ms ease",
            // 触屏点击不出现高亮块
            WebkitTapHighlightColor: "transparent",
          },
        },
        isRunning
          ? h(IconSpinner)
          : isDone
            ? h(IconUndo)
            : isRestored
              ? h(IconRedo)
              : h(IconWand)
        )
      );
    }

    /**
     * input.right 组件。props 由 inject(sessionId) 提供：{ inputActions, draft, route }。
     * 可能还会带上 input（dock 场景），一并兼容。
     */
    function EnhanceDock(props) {
      const { draft, input, inputActions, route, useInput, directory, sessionId } = props || {};

      // 1) 优先用宿主提供的 useInput hook（真正响应式）
      let liveDraft;
      if (typeof useInput === "function") {
        try {
          const snapshot = useInput((s) => s);
          liveDraft = pickDraft(snapshot);
        } catch {
          liveDraft = undefined;
        }
      }
      // 2) 退路：props.input（dock 场景）
      if (liveDraft === undefined && input !== undefined) liveDraft = pickDraft(input);
      // 3) 最后：inject 注入的一次性 draft
      if (liveDraft === undefined) liveDraft = typeof draft === "string" ? draft : "";

      return h(EnhanceButton, {
        inputActions,
        draftText: liveDraft,
        route,
        directory,
        sessionId: props && props.sessionId,
      });
    }

    const inject = ["slots", "sessions", "modelDirectories"];

    function apply(ctx) {
      try {
        ctx.slots.inject("conversation.input.right", () =>
          ctx.slots.register(
            {
              name: "conversation.input.right",
              id: "dsh-enhance-prompt",
              order: 30,
              locale: NS,
              // input.right 的 props 是空对象，草稿与 actions 都从这里注入
              inject: (sessionId) => {
                let inputActions;
                let draft = "";
                let route;
                try {
                  const actx = ctx.sessions.scope(sessionId);

                  // 1) 输入 shell：草稿 + actions
                  const conversation =
                    actx && typeof actx.get === "function" ? actx.get("conversation") : undefined;
                  if (
                    conversation &&
                    conversation.input &&
                    typeof conversation.input.for === "function"
                  ) {
                    const shell = conversation.input.for(actx);
                    if (shell) {
                      if (shell.actions) inputActions = shell.actions;
                      const st = shell.state;
                      if (st && typeof st.draft === "string") draft = st.draft;
                    }
                  }

                  // 2) 当前模型路由
                  const session =
                    actx && typeof actx.get === "function" ? actx.get("session") : undefined;
                  const model =
                    session && session.projections
                      ? session.projections.faceOf("modelSelection").getSnapshot()
                      : undefined;
                  const selection = (model && (model.next || model.lastUsed)) || undefined;
                  if (selection) {
                    route = {
                      provider: selection.provider,
                      model: selection.model,
                      effort: selection.reasoningEffort,
                    };
                  }
                } catch {
                  /* 拿不到就不注入，node 端会兜底 */
                }

                // 3) DSH 模型目录（与模型选择器同源）
                let directory;
                try {
                  if (ctx.modelDirectories && typeof ctx.modelDirectories.directoryFor === "function") {
                    const d = ctx.modelDirectories.directoryFor(sessionId);
                    if (d && d.store) directory = d.store;
                  }
                } catch {
                  /* 拿不到就只显示会话当前模型 */
                }

                return { inputActions, draft, route, directory, sessionId };
              },
            },
            EnhanceDock
          )
        );
      } catch (e) {
        console.error("[dsh-enhance-prompt] apply failed", e);
      }
    }

    exports.name = NS;
    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  },
});
