import { jsxs as h, jsx as p } from "react/jsx-runtime";
import { useState as s, useRef as I, useCallback as O, useEffect as C } from "react";
function W(e, l) {
  const [w, D] = s(!0), [k, g] = s(null), [E, v] = s(!1), [x, R] = s(e.theme), [L, m] = s(null), [M, S] = s(e.isSourceModeActive?.() ?? !1), a = I(l);
  a.current = l;
  const o = I(""), y = I(!1), i = O(
    (r) => {
      const { parse: n } = a.current;
      return n ? n(r) : r;
    },
    []
    // stable -- reads from ref
  ), f = O(
    (r) => {
      const { serialize: n } = a.current;
      return n ? n(r) : String(r);
    },
    []
    // stable -- reads from ref
  ), c = O(() => {
    a.current.getCurrentContent && (y.current || (y.current = !0, v(!0), e.setDirty(!0)));
  }, [e]), d = O(() => {
    y.current && (y.current = !1, v(!1), e.setDirty(!1));
  }, [e]);
  C(() => {
    let r = !0;
    return (async () => {
      try {
        const t = a.current;
        if (t.binary) {
          const u = await e.loadBinaryContent();
          if (!r)
            return;
          t.applyContent(u);
        } else {
          const u = await e.loadContent();
          if (!r)
            return;
          const b = i(u);
          o.current = u, t.applyContent(b);
        }
        if (!r)
          return;
        g(null), D(!1), a.current.onLoaded?.();
      } catch (t) {
        if (!r)
          return;
        const u = t instanceof Error ? t : new Error(String(t));
        g(u), D(!1);
      }
    })(), () => {
      r = !1;
    };
  }, [e, i]), C(() => e.onSaveRequested(async () => {
    const r = a.current;
    try {
      if (r.onSave)
        await r.onSave();
      else {
        if (!r.getCurrentContent)
          return;
        const n = r.getCurrentContent();
        if (r.binary)
          await e.saveContent(n);
        else {
          const t = f(n);
          o.current = t, await e.saveContent(t);
        }
      }
      d();
    } catch {
    }
  }), [e, f, d]), C(() => e.onFileChanged((r) => {
    if (r === o.current)
      return;
    const n = a.current;
    try {
      const t = i(r);
      o.current = r, n.applyContent(t), g(null), d(), n.onExternalChange?.(t);
    } catch {
    }
  }), [e, i, d]), C(() => e.onThemeChanged((r) => {
    R(r);
  }), [e]), C(() => e.onDiffRequested ? e.onDiffRequested((n) => {
    const t = a.current;
    if (t.onDiffRequested) {
      t.onDiffRequested(n);
      return;
    }
    let u, b;
    try {
      u = t.binary ? n.originalContent : i(n.originalContent), b = t.binary ? n.modifiedContent : i(n.modifiedContent);
    } catch {
      return;
    }
    m({
      original: u,
      modified: b,
      tagId: n.tagId,
      sessionId: n.sessionId,
      accept: () => {
        a.current.applyContent(b), t.binary || (o.current = f(b)), e.reportDiffResult?.({
          content: t.binary ? "" : f(b),
          action: "accept"
        }), d(), m(null);
      },
      reject: () => {
        a.current.applyContent(u), t.binary || (o.current = f(u)), e.reportDiffResult?.({
          content: t.binary ? "" : f(u),
          action: "reject"
        }), d(), m(null);
      }
    });
  }) : void 0, [e, i, f, d]), C(() => {
    if (e.onDiffCleared)
      return e.onDiffCleared(async () => {
        const r = a.current;
        if (r.onDiffCleared) {
          await r.onDiffCleared();
          return;
        }
        m(null), r.binary || e.loadContent().then((n) => {
          const t = i(n);
          o.current = n, a.current.applyContent(t), d();
        });
      });
  }, [e, i, d]), C(() => {
    if (e.onSourceModeChanged)
      return e.onSourceModeChanged((r) => {
        S(r);
      });
  }, [e]);
  const T = e.toggleSourceMode ? O(() => e.toggleSourceMode?.(), [e]) : void 0;
  return {
    markDirty: c,
    isLoading: w,
    error: k,
    theme: x,
    isDirty: E,
    diffState: L,
    toggleSourceMode: T,
    isSourceMode: M
  };
}
function A({ host: e }) {
  const l = I(""), [w, D] = s(""), [k, g] = s(!1), [E, v] = s(null), [x, R] = s(null), [L, m] = s(null), [M, S] = s(null), [, a] = s(0), o = W(e, {
    applyContent(c) {
      l.current = c, D(c);
    },
    getCurrentContent() {
      return l.current;
    }
  }), y = I(!1);
  y.current = o.isDirty;
  const i = () => ({
    filePath: e.filePath,
    workspaceId: e.workspaceId ?? null,
    hostIsActive: e.isActive,
    localDirty: y.current,
    buffer: l.current,
    bufferUtf8Bytes: new TextEncoder().encode(l.current).length
  }), f = async () => {
    if (!(k || !e.openWorkspaceFile)) {
      g(!0), R(null), v(null), S(null), m(i());
      try {
        const c = await e.openWorkspaceFile();
        v(c), S(i());
      } catch (c) {
        R(c instanceof Error ? c.message : String(c)), S(i());
      } finally {
        g(!1);
      }
    }
  };
  return /* @__PURE__ */ h("section", { "aria-label": "Workspace Open verification probe", style: { padding: 16, display: "grid", gap: 12 }, children: [
    /* @__PURE__ */ p("h2", { children: "Workspace Open verification probe" }),
    /* @__PURE__ */ p("p", { children: "This is a development-host verification fixture; not a released Terraphim feature." }),
    o.error && /* @__PURE__ */ p("p", { role: "alert", children: o.error.message }),
    /* @__PURE__ */ h("label", { children: [
      "Probe document buffer",
      /* @__PURE__ */ p(
        "textarea",
        {
          "aria-label": "Probe document buffer",
          value: w,
          disabled: o.isLoading || !!o.error,
          onChange: (c) => {
            l.current = c.currentTarget.value, D(l.current), o.markDirty();
          },
          style: { display: "block", width: "100%", minHeight: 100 }
        }
      )
    ] }),
    /* @__PURE__ */ p(
      "button",
      {
        type: "button",
        onClick: () => {
          f();
        },
        disabled: k || o.isLoading || !e.openWorkspaceFile,
        children: k ? "Native chooser pending" : "Open workspace file through custom-editor API"
      }
    ),
    !e.openWorkspaceFile && /* @__PURE__ */ p("p", { role: "status", children: "Optional host capability is absent; no chooser was called." }),
    /* @__PURE__ */ p("button", { type: "button", onClick: () => a((c) => c + 1), children: "Refresh host and buffer readback" }),
    /* @__PURE__ */ p("pre", { "aria-label": "Actual probe readback", children: JSON.stringify({
      current: i(),
      beforeOpen: L,
      afterOpen: M,
      outcome: E,
      failure: x,
      nativeTabReadback: "Observe the actual host tab bar separately; no private tab-store access is used."
    }, null, 2) })
  ] });
}
const B = { WorkspaceOpenProbe: A };
export {
  A as WorkspaceOpenProbe,
  B as components
};
//# sourceMappingURL=index.js.map
