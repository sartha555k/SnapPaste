import React, { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clipboard,
  ClipboardPaste,
  Code2,
  Copy,
  FileText,
  ImagePlus,
  LayoutGrid,
  LoaderCircle,
  LockKeyhole,
  Maximize2,
  MessageSquare,
  Scan,
  Settings2,
  ShieldCheck,
  Sparkles,
  Table2,
  X,
  Zap,
  Calendar,
  ChartNoAxesCombined,
  PanelsTopLeft,
} from "lucide-react";
import { ACTIONS, CATEGORIES } from "../shared/actions";
import type {
  ActionId,
  Capture,
  HistoryPage,
  PasteAction,
  PasteResult,
  Permissions,
  Settings,
  SettingsUpdate,
} from "../shared/types";
import "./styles.css";
const api = window.snapPaste;
const icons: Record<PasteAction["icon"], typeof FileText> = {
  text: FileText,
  table: Table2,
  code: Code2,
  message: MessageSquare,
  receipt: Clipboard,
  calendar: Calendar,
  chart: ChartNoAxesCombined,
  design: PanelsTopLeft,
  summary: LayoutGrid,
  sparkles: Sparkles,
};
function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(
    /^Error invoking remote method '[^']+': Error: /,
    "",
  );
}
function prettyShortcut(value: string) {
  return value
    .replace("CommandOrControl", "⌘")
    .replace("Command", "⌘")
    .replace("Control", "⌃")
    .replace("Alt", "⌥")
    .replace("Shift", "⇧")
    .split("+")
    .join(" ");
}
const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export default function App() {
  const [catalogueInfo, setCatalogueInfo] = useState<Awaited<
    ReturnType<typeof api.catalogueStatus>
  > | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [history, setHistory] = useState<HistoryPage | null>(null);
  const [capture, setCapture] = useState<Capture | null>(null);
  const [compact, setCompact] = useState(false);
  const [picker, setPicker] = useState(false);
  const [result, setResult] = useState<PasteResult | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [custom, setCustom] = useState(false);
  const [instruction, setInstruction] = useState("");
  const operation = useRef(0);
  const currentCapture = useRef<Capture | null>(null);
  const refreshHistory = useCallback(
    async () => setHistory(await api.listHistory()),
    [],
  );
  const receiveCapture = useCallback((value: Capture | null) => {
    if (
      !value ||
      value.id !== currentCapture.current?.id ||
      value.phase === "reading"
    ) {
      operation.current++;
      setResult(null);
      setBusy("");
      setEditing(false);
      setCustom(false);
      setError("");
    }
    currentCapture.current = value;
    setCapture(value);
  }, []);
  useEffect(() => {
    void api.catalogueStatus().then(setCatalogueInfo);
    const syncTimer = setInterval(() => {
      void api.catalogueStatus().then(setCatalogueInfo);
    }, 15000);
    void api
      .getSettings()
      .then(setSettings)
      .catch((e) => setError(errorMessage(e)));
    void api.getCapture().then(receiveCapture);
    void refreshHistory().catch((e) => setError(errorMessage(e)));
    const off = [
      api.onCapture(receiveCapture),
      api.onHistory(() => {
        void refreshHistory().catch((e) => setError(errorMessage(e)));
      }),
      api.onNotice(setError),
      api.onSettings(() => setSettingsOpen(true)),
      api.onMode((value) => {
        operation.current++;
        setCompact(value);
        setPicker(false);
        setResult(null);
        setBusy("");
        setError("");
        setCustom(false);
      }),
    ];
    return () => {
      clearInterval(syncTimer);
      off.forEach((unsubscribe) => unsubscribe());
    };
  }, [receiveCapture, refreshHistory]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 2500);
    return () => clearTimeout(timer);
  }, [toast]);
  async function add(kind: "screen" | "import" | "table" | "code") {
    setError("");
    try {
      if (kind === "screen") await api.captureScreen();
      else if (kind === "import") await api.importImage();
      else await api.loadExample(kind);
      await refreshHistory();
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  async function select(id: string) {
    setError("");
    setPicker(false);
    try {
      await api.selectHistory(id);
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  async function run(id: ActionId, prompt = "") {
    if (!capture || capture.phase === "reading" || busy) return;
    if (id === "custom" && !prompt.trim()) {
      setCustom(true);
      return;
    }
    const op = ++operation.current;
    setBusy(
      id === "text"
        ? "Reading local text"
        : `Creating ${(capture.analysis.actions.find((a) => a.id === id)?.title ?? ACTIONS[id]?.title ?? "output").toLowerCase()}`,
    );
    setError("");
    try {
      const output = await api.generate(capture.id, id, prompt);
      if (operation.current === op) {
        setResult(output);
        setEditing(false);
        setCustom(false);
      }
    } catch (e) {
      if (operation.current === op) setError(errorMessage(e));
    } finally {
      if (operation.current === op) setBusy("");
    }
  }
  async function transfer(paste: boolean) {
    if (!result) return;
    try {
      if (paste) await api.paste(result);
      else {
        await api.copy(result);
        setToast("Copied. Ready to paste.");
      }
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  async function cancel() {
    operation.current++;
    setBusy("");
    await api.cancel();
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        settingsOpen ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(
          (e.target as HTMLElement).tagName,
        ) ||
        e.isComposing
      )
        return;
      if (e.key === "Escape") {
        e.preventDefault();
        if (result) setResult(null);
        else void api.hide();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && result) {
        e.preventDefault();
        void transfer(true);
      }
      if (
        compact &&
        !picker &&
        !result &&
        !busy &&
        !custom &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        /^[1-4]$/.test(e.key)
      ) {
        const action = capture?.analysis.actions[Number(e.key) - 1];
        if (action) {
          e.preventDefault();
          void run(action.id);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const actions = capture?.analysis.actions ?? [];
  const classifying = !!capture && capture.phase !== "ready";
  const stage =
    capture?.phase === "reading"
      ? "Reading text locally…"
      : capture?.analysis.stage === "ranking"
        ? "Loading your screenshot’s menu…"
        : "Jev is recognizing this screenshot…";
  const historyCards = history?.items.map((item) => (
    <button
      className="history-card"
      key={item.id}
      onClick={() => void select(item.id)}
      aria-label={`Choose ${item.name}`}
    >
      <div className="history-image">
        <img src={item.thumbnail} alt="" />
      </div>
      <strong>{item.name}</strong>
      <span>
        {item.width} × {item.height}{" "}
        <span>
          ·{" "}
          {new Date(item.createdAt).toLocaleDateString([], {
            month: "short",
            day: "numeric",
          })}
        </span>
      </span>
      <div className="card-action">
        Choose paste actions <ArrowRight size={13} />
      </div>
    </button>
  ));
  return (
    <div className={`app-shell ${compact ? "compact" : ""}`}>
      <header className="titlebar">
        <div className="brand">
          <span className="brand-mark">
            <ClipboardPaste size={17} />
          </span>
          SnapPaste <span className="beta">BETA</span>
        </div>
        <div className="header-tools">
          {compact ? (
            <button
              className="icon-button"
              aria-label="Open screenshot history"
              onClick={() => void api.expand()}
            >
              <Maximize2 size={16} />
            </button>
          ) : (
            settings && (
              <span className="shortcut-label">
                Smart paste <kbd>{prettyShortcut(settings.shortcut)}</kbd>
              </span>
            )
          )}
          <button
            className="icon-button"
            aria-label="Settings"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 size={17} />
          </button>
        </div>
      </header>
      {error && (
        <div className="notice error" role="alert">
          <span>{error}</span>
          <button
            className="icon-button"
            aria-label="Dismiss error"
            onClick={() => setError("")}
          >
            <X size={13} />
          </button>
        </div>
      )}
      {!compact ? (
        <main className="library">
          <section className="library-heading">
            <div>
              <div className="eyebrow">
                <span className="tiny-dot" /> CAPTURE NOW. DECIDE AT PASTE.
              </div>
              <h1>
                Your screenshots, <span>ready for more.</span>
              </h1>
              <p>
                Keep capturing. When you’re ready to paste, choose what the
                image becomes.
              </p>
            </div>
            <button
              className="primary-button"
              onClick={() => void add("screen")}
            >
              <Scan size={16} /> Capture a region{" "}
              {settings && (
                <kbd>{prettyShortcut(settings.captureShortcut)}</kbd>
              )}
            </button>
          </section>
          <div className="workflow-strip">
            <div>
              <span className="step-number">1</span>
              <span>
                <strong>Capture freely</strong>
                <small>Screenshots stay on this Mac.</small>
              </span>
            </div>
            <ArrowRight size={16} />
            <div>
              <span className="step-number">2</span>
              <span>
                <strong>
                  Press{" "}
                  {settings
                    ? prettyShortcut(settings.shortcut)
                    : "your shortcut"}
                </strong>
                <small>
                  Your screenshot’s menu prepares in the background.
                </small>
              </span>
            </div>
            <ArrowRight size={16} />
            <div>
              <span className="step-number">3</span>
              <span>
                <strong>Pick, review, paste</strong>
                <small>Local text or a specific AI task.</small>
              </span>
            </div>
          </div>
          <div className="library-toolbar">
            <h2>
              Screenshot history <span>{history?.total ?? 0}</span>
            </h2>
            <div>
              <button className="text-button" onClick={() => void add("table")}>
                Try a table
              </button>
              <button className="text-button" onClick={() => void add("code")}>
                Try a pull request
              </button>
              <button
                className="secondary-button small"
                onClick={() => void add("import")}
              >
                <ImagePlus size={14} /> Add images
              </button>
            </div>
          </div>
          <div className="library-scroll">
            {history?.total ? (
              <div className="history-grid">{historyCards}</div>
            ) : (
              <div className="library-empty">
                <div className="empty-stack">
                  <Scan size={30} />
                </div>
                <h2>Many screenshots. Four useful choices.</h2>
                <p>
                  Capture a region or add images. Your paste menu changes with
                  the content—not a fixed set of buttons.
                </p>
                <button
                  className="secondary-button"
                  onClick={() => void add("import")}
                >
                  <ImagePlus size={15} /> Add your first screenshots
                </button>
                <small>
                  You can also try the example table and pull request above.
                </small>
              </div>
            )}
            {history?.hasMore && (
              <button
                className="load-more secondary-button"
                onClick={() =>
                  void api
                    .listHistory(history.items.length)
                    .then((page) =>
                      setHistory({
                        ...page,
                        items: [...history.items, ...page.items],
                      }),
                    )
                    .catch((e) => setError(errorMessage(e)))
                }
              >
                Load older screenshots
              </button>
            )}
          </div>
          <div className="library-bottom">
            <span>
              {history
                ? `${megabytes(history.bytes)} of ${megabytes(history.limitBytes)} used`
                : "Local screenshot storage"}{" "}
              · oldest captures expire when full
            </span>
            <span title={catalogueInfo?.error}>
              {catalogueInfo
                ? `${catalogueInfo.categories} categories · ${catalogueInfo.subcategories} screenshot types · ${catalogueInfo.source === "supabase" ? "Synced" : catalogueInfo.source === "cache" ? "Cached" : "Built-in menus"}`
                : "Menus prepare in the background"}
            </span>
          </div>
        </main>
      ) : (
        <main className="paste-main">
          {picker ? (
            <>
              <div className="picker-heading">
                <button
                  className="icon-button"
                  aria-label="Back to paste options"
                  onClick={() => setPicker(false)}
                >
                  <ArrowLeft size={17} />
                </button>
                <h2>Choose a screenshot</h2>
                <span>{history?.total ?? 0} saved</span>
              </div>
              <div className="picker-scroll">
                <div className="history-grid">{historyCards}</div>
                {history?.hasMore && (
                  <button
                    className="load-more secondary-button"
                    onClick={() =>
                      void api
                        .listHistory(history.items.length)
                        .then((page) =>
                          setHistory({
                            ...page,
                            items: [...history.items, ...page.items],
                          }),
                        )
                        .catch((e) => setError(errorMessage(e)))
                    }
                  >
                    Load older screenshots
                  </button>
                )}
              </div>
            </>
          ) : !capture ? (
            <div className="library-empty">
              <Scan size={32} />
              <h2>Choose what to paste</h2>
              <p>Copy a screenshot, or choose one from your history.</p>
              <button
                className="primary-button"
                onClick={() => setPicker(true)}
              >
                Open screenshot history
              </button>
            </div>
          ) : (
            <>
              <button
                className="paste-source"
                onClick={() => {
                  setPicker(true);
                  void refreshHistory();
                }}
              >
                <img src={capture.dataUrl} alt="Selected screenshot" />
                <span>
                  <strong>{capture.name}</strong>
                  <small>
                    {classifying && capture.analysis.stage !== "ranking"
                      ? "Recognizing content"
                      : (capture.analysis.subcategoryTitle ??
                        capture.analysis.categoryTitle ??
                        CATEGORIES[capture.analysis.category]?.title ??
                        "Screenshot")}{" "}
                    · choose another
                  </small>
                </span>
                <LayoutGrid size={15} />
              </button>
              <div className="paste-scroll">
                {result ? (
                  <section className="result-view">
                    <div className="result-heading">
                      <button
                        className="icon-button"
                        aria-label="Back to paste options"
                        onClick={() => setResult(null)}
                      >
                        <ArrowLeft size={16} />
                      </button>
                      <h2>
                        {capture.analysis.actions.find(
                          (a) => a.id === result.actionId,
                        )?.title ??
                          ACTIONS[result.actionId]?.title ??
                          "Ready to paste"}
                      </h2>
                      {result.kind === "text" && (
                        <button
                          className="text-button"
                          onClick={() => setEditing(!editing)}
                        >
                          {editing ? "Preview" : "Edit"}
                        </button>
                      )}
                    </div>
                    <div className="result-meta">
                      {result.source} · {(result.elapsedMs / 1000).toFixed(1)}s
                      · review before pasting
                    </div>
                    {result.kind === "table" ? (
                      <div className="editable-table">
                        <table>
                          <thead>
                            <tr>
                              {result.headers.map((cell, col) => (
                                <th key={col}>
                                  <input
                                    aria-label={`Column ${col + 1} heading`}
                                    value={cell}
                                    onChange={(e) =>
                                      setResult({
                                        ...result,
                                        headers: result.headers.map((c, i) =>
                                          i === col ? e.target.value : c,
                                        ),
                                      })
                                    }
                                  />
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {result.rows.map((row, r) => (
                              <tr key={r}>
                                {row.map((cell, c) => (
                                  <td key={c}>
                                    <input
                                      aria-label={`Row ${r + 1} column ${c + 1}`}
                                      value={cell}
                                      onChange={(e) =>
                                        setResult({
                                          ...result,
                                          rows: result.rows.map((old, i) =>
                                            i === r
                                              ? old.map((v, j) =>
                                                  j === c ? e.target.value : v,
                                                )
                                              : old,
                                          ),
                                        })
                                      }
                                    />
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : editing ? (
                      <textarea
                        className="result-editor"
                        aria-label="Edit paste result"
                        value={result.text}
                        onChange={(e) =>
                          setResult({ ...result, text: e.target.value })
                        }
                      />
                    ) : (
                      <div className="markdown">
                        {result.actionId === "text" ? (
                          <pre>{result.text}</pre>
                        ) : (
                          <ReactMarkdown
                            skipHtml
                            components={{
                              a: ({ children }) => <span>{children}</span>,
                            }}
                          >
                            {result.text}
                          </ReactMarkdown>
                        )}
                      </div>
                    )}
                    {result.notes.length > 0 && (
                      <div className="result-notes">
                        <strong>Check these details</strong>
                        {result.notes.map((note, i) => (
                          <p key={i}>{note}</p>
                        ))}
                      </div>
                    )}
                    <p className="result-caption">
                      {result.kind === "table"
                        ? "Edit any cell. Copies as spreadsheet cells and a formatted table."
                        : "Review the content, then copy or paste into your previous app."}
                    </p>
                    <div className="result-buttons">
                      <button
                        className="secondary-button"
                        onClick={() => void transfer(false)}
                      >
                        <Copy size={15} /> Copy
                      </button>
                      <button
                        className="primary-button"
                        onClick={() => void transfer(true)}
                      >
                        <ClipboardPaste size={15} /> Paste into app{" "}
                        <kbd>⌘ ↵</kbd>
                      </button>
                    </div>
                  </section>
                ) : (
                  <section className="actions-view">
                    <div className="actions-intro">
                      <div className="eyebrow">
                        {classifying ? (
                          <>
                            <LoaderCircle size={11} className="spin" />
                            {stage}
                          </>
                        ) : capture.analysis.source === "jev" ? (
                          <>
                            <Sparkles size={11} /> MATCHED TO YOUR SCREENSHOT
                          </>
                        ) : (
                          "LOCAL FALLBACK · JEV NOT USED"
                        )}
                      </div>
                      <h2>How would you like to paste?</h2>
                      <p>
                        Four useful choices. Local processing where supported.
                      </p>
                    </div>
                    <div className="action-list">
                      {Array.from({ length: 4 }, (_, index) => {
                        const action = actions[index];
                        if (!action)
                          return (
                            <div
                              key={`loading-${index}`}
                              className="action-card action-loading"
                            >
                              <span className="skeleton-icon" />
                              <span>
                                <strong>Finding a useful action…</strong>
                                <small>Matching the screenshot type</small>
                              </span>
                              <span className="action-key">{index + 1}</span>
                            </div>
                          );
                        const Icon = icons[action.icon];
                        return (
                          <button
                            className="action-card"
                            key={action.id}
                            disabled={!!busy || capture.phase === "reading"}
                            onClick={() => void run(action.id)}
                          >
                            <span
                              className={`action-icon ${action.cloud ? "" : "local-icon"}`}
                            >
                              <Icon size={19} />
                            </span>
                            <span className="action-copy">
                              <span className="action-title">
                                {action.title}
                                <span
                                  className={`action-badge ${action.cloud ? "" : "local"}`}
                                >
                                  {action.badge}
                                </span>
                              </span>
                              <span className="action-description">
                                {action.description}
                              </span>
                            </span>
                            <span className="action-key">{index + 1}</span>
                          </button>
                        );
                      })}
                    </div>
                    {capture.analysis.warning && (
                      <p className="classification-warning">
                        {capture.analysis.warning}
                      </p>
                    )}
                    {busy && (
                      <div className="busy-row" role="status">
                        <LoaderCircle size={15} className="spin" />
                        <span>{busy}…</span>
                        <button
                          className="text-button"
                          onClick={() => void cancel()}
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                    {custom && (
                      <div className="custom-box">
                        <textarea
                          aria-label="Custom instruction"
                          placeholder="What do you want from this screenshot?"
                          value={instruction}
                          maxLength={4000}
                          onChange={(e) => setInstruction(e.target.value)}
                        />
                        <button
                          className="primary-button small"
                          disabled={!instruction.trim() || !!busy}
                          onClick={() => void run("custom", instruction)}
                        >
                          Create result <ArrowRight size={13} />
                        </button>
                      </div>
                    )}
                    {!!settings?.prompts.length && (
                      <select
                        aria-label="Saved prompts"
                        className="prompt-select"
                        value=""
                        disabled={!!busy || capture.phase === "reading"}
                        onChange={(e) => {
                          const prompt = settings.prompts.find(
                            (p) => p.id === e.target.value,
                          );
                          if (prompt) {
                            setInstruction(prompt.instruction);
                            setCustom(true);
                          }
                        }}
                      >
                        <option value="">Use a saved prompt…</option>
                        {settings.prompts.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </section>
                )}
              </div>
            </>
          )}
        </main>
      )}
      <footer>
        <span>
          <ShieldCheck size={13} />
          {compact
            ? "OpenAI runs only after you choose an AI action"
            : "Screenshot history stays on this Mac"}
        </span>
        <span>
          {compact ? (
            <>
              <kbd>1–4</kbd> choose · <kbd>esc</kbd> dismiss
            </>
          ) : (
            "macOS · 0.2"
          )}
        </span>
      </footer>
      {toast && (
        <div className="toast" role="status">
          <Check size={15} />
          {toast}
        </div>
      )}
      {settingsOpen && settings && (
        <SettingsDialog
          settings={settings}
          onClose={() => setSettingsOpen(false)}
          onSaved={(value) => {
            setSettings(value);
            setToast("Settings saved");
            void refreshHistory();
          }}
        />
      )}
    </div>
  );
}
function SettingsDialog({
  settings,
  onClose,
  onSaved,
}: {
  settings: Settings;
  onClose: () => void;
  onSaved: (settings: Settings) => void;
}) {
  const [draft, setDraft] = useState<SettingsUpdate>({
    shortcut: settings.shortcut,
    captureShortcut: settings.captureShortcut,
    watchClipboard: settings.watchClipboard,
    historyLimitMB: settings.historyLimitMB,
    openaiModel: settings.openaiModel,
    jevModel: settings.jevModel,
    cloudEnabled: settings.cloudEnabled,
    prompts: settings.prompts,
  });
  const [tab, setTab] = useState<"general" | "prompts">("general");
  const [permissions, setPermissions] = useState<Permissions | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const refresh = () => {
      void api.permissions().then(setPermissions);
    };
    refresh();
    window.addEventListener("focus", refresh);
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", close, true);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("keydown", close, true);
    };
  }, [onClose]);
  async function save() {
    setSaving(true);
    setError("");
    try {
      onSaved(await api.saveSettings(draft));
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="modal-backdrop">
      <section
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <div className="modal-header">
          <div>
            <div className="eyebrow">MAKE YOURSELF AT HOME</div>
            <h2 id="settings-title">Settings</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close settings"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <div className="settings-tabs">
          <button
            className={tab === "general" ? "active" : ""}
            onClick={() => setTab("general")}
          >
            General & AI
          </button>
          <button
            className={tab === "prompts" ? "active" : ""}
            onClick={() => setTab("prompts")}
          >
            Saved prompts <span>{draft.prompts.length}</span>
          </button>
        </div>
        <div className="settings-body">
          {tab === "general" ? (
            <>
              <label className="setting-field">
                Smart-paste shortcut
                <input
                  value={draft.shortcut}
                  onChange={(e) =>
                    setDraft({ ...draft, shortcut: e.target.value })
                  }
                />
                <small>
                  Example: CommandOrControl+Alt+V. Ordinary ⌘ V keeps working.
                </small>
              </label>
              <label className="setting-field">
                Screenshot shortcut
                <input
                  value={draft.captureShortcut}
                  onChange={(e) =>
                    setDraft({ ...draft, captureShortcut: e.target.value })
                  }
                />
                <small>
                  Captures a region and prepares its paste options in the
                  background.
                </small>
              </label>
              <label className="setting-field">
                Local history budget (MB)
                <input
                  type="number"
                  min={50}
                  max={2000}
                  value={draft.historyLimitMB}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      historyLimitMB: Number(e.target.value),
                    })
                  }
                />
                <small>
                  No screenshot-count limit. Oldest captures expire when storage
                  fills up; original files are never deleted.
                </small>
              </label>
              <div className="cloud-setting">
                <div>
                  <strong>Save copied screenshots automatically</strong>
                  <p>
                    While SnapPaste runs, save new clipboard images locally. Use
                    ⇧ ⌃ ⌘ 4 for macOS screenshots copied to the clipboard. New
                    standard macOS screenshot files are also detected in your
                    screenshot folder.
                  </p>
                </div>
                <button
                  role="switch"
                  aria-label="Save copied screenshots automatically"
                  aria-checked={draft.watchClipboard}
                  className={`toggle ${draft.watchClipboard ? "on" : ""}`}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      watchClipboard: !draft.watchClipboard,
                    })
                  }
                >
                  <span />
                </button>
              </div>
              <div className="cloud-setting">
                <div>
                  <strong>Enable cloud processing</strong>
                  <p>
                    After capture, Jev selects a screenshot type in one request.
                    Option 2 prepares automatically when AI is needed; options 3
                    and 4 run when selected. Supported extraction stays local.
                  </p>
                </div>
                <button
                  role="switch"
                  aria-checked={draft.cloudEnabled}
                  aria-label="Enable cloud processing"
                  className={`toggle ${draft.cloudEnabled ? "on" : ""}`}
                  onClick={() =>
                    setDraft({ ...draft, cloudEnabled: !draft.cloudEnabled })
                  }
                >
                  <span />
                </button>
              </div>
              <label className="setting-field">
                OpenAI API key{" "}
                <span className="field-status">
                  {settings.hasOpenAIKey ? "Key saved" : "Not configured"}
                </span>
                <input
                  type="password"
                  autoComplete="off"
                  placeholder={
                    settings.hasOpenAIKey
                      ? "Leave blank to keep your saved key"
                      : "Enter your OpenAI API key"
                  }
                  value={draft.openaiKey ?? ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      openaiKey: e.target.value,
                      clearOpenAIKey: false,
                    })
                  }
                />
                {settings.hasOpenAIKey && (
                  <button
                    className="text-button danger"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        clearOpenAIKey: true,
                        openaiKey: "",
                      })
                    }
                  >
                    {draft.clearOpenAIKey
                      ? "Key will be removed on save"
                      : "Remove saved key"}
                  </button>
                )}
              </label>
              <label className="setting-field">
                OpenAI model
                <input
                  value={draft.openaiModel}
                  onChange={(e) =>
                    setDraft({ ...draft, openaiModel: e.target.value })
                  }
                />
              </label>
              <label className="setting-field">
                Jev API key{" "}
                <span className="field-status">
                  Optional · experimental vision
                </span>
                <input
                  type="password"
                  autoComplete="off"
                  placeholder={
                    settings.hasJevKey
                      ? "Leave blank to keep your saved key"
                      : "Enter your TypeSafe API key"
                  }
                  value={draft.jevKey ?? ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      jevKey: e.target.value,
                      clearJevKey: false,
                    })
                  }
                />
                {settings.hasJevKey && (
                  <button
                    className="text-button danger"
                    onClick={() =>
                      setDraft({ ...draft, clearJevKey: true, jevKey: "" })
                    }
                  >
                    {draft.clearJevKey
                      ? "Key will be removed on save"
                      : "Remove saved key"}
                  </button>
                )}
                <small>
                  Without Jev, a general fallback menu is shown. Local text and
                  supported extraction remain available.
                </small>
              </label>
              <label className="setting-field">
                Jev model
                <input
                  value={draft.jevModel}
                  onChange={(e) =>
                    setDraft({ ...draft, jevModel: e.target.value })
                  }
                />
              </label>
              <div className="permission-section">
                <strong>macOS permissions</strong>
                <div>
                  <span>
                    Automatic paste{" "}
                    <small>
                      {permissions?.accessibility
                        ? "Allowed"
                        : "Accessibility needed"}
                    </small>
                  </span>
                  <button
                    className="secondary-button small"
                    onClick={() => void api.openPermission("accessibility")}
                  >
                    Open settings <ArrowRight size={12} />
                  </button>
                </div>
                <div>
                  <span>
                    Capture region{" "}
                    <small>
                      {permissions?.screen === "granted"
                        ? "Allowed"
                        : "Screen Recording needed"}
                    </small>
                  </span>
                  <button
                    className="secondary-button small"
                    onClick={() => void api.openPermission("screen")}
                  >
                    Open settings <ArrowRight size={12} />
                  </button>
                </div>
              </div>
              <p className="secure-note">
                <LockKeyhole size={13} /> Keys are encrypted using macOS secure
                storage. Screenshot history is stored locally on this Mac.
              </p>
            </>
          ) : (
            <div className="saved-prompts">
              <p>Save the instructions you reach for again and again.</p>
              {draft.prompts.map((p, i) => (
                <div className="saved-prompt" key={p.id}>
                  <div>
                    <input
                      aria-label={`Prompt ${i + 1} name`}
                      placeholder="Prompt name"
                      maxLength={80}
                      value={p.name}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          prompts: draft.prompts.map((old, j) =>
                            j === i ? { ...old, name: e.target.value } : old,
                          ),
                        })
                      }
                    />
                    <button
                      className="icon-button"
                      aria-label={`Remove prompt ${i + 1}`}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          prompts: draft.prompts.filter((_, j) => j !== i),
                        })
                      }
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <textarea
                    aria-label={`Prompt ${i + 1} instruction`}
                    placeholder="Extract only the product names and prices…"
                    maxLength={4000}
                    value={p.instruction}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        prompts: draft.prompts.map((old, j) =>
                          j === i
                            ? { ...old, instruction: e.target.value }
                            : old,
                        ),
                      })
                    }
                  />
                </div>
              ))}
              <button
                className="secondary-button"
                disabled={draft.prompts.length >= 30}
                onClick={() =>
                  setDraft({
                    ...draft,
                    prompts: [
                      ...draft.prompts,
                      { id: crypto.randomUUID(), name: "", instruction: "" },
                    ],
                  })
                }
              >
                + Add prompt
              </button>
            </div>
          )}
        </div>
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-footer">
          <button className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving && <LoaderCircle size={14} className="spin" />} Save changes
          </button>
        </div>
      </section>
    </div>
  );
}
