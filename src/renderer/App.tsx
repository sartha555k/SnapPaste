import React, { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Clipboard,
  ClipboardPaste,
  Code2,
  Command,
  Copy,
  FileText,
  ImagePlus,
  LayoutGrid,
  LoaderCircle,
  LockKeyhole,
  Maximize2,
  MessageSquare,
  Monitor,
  Scan,
  Settings2,
  ShieldCheck,
  Sparkles,
  Table2,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";
import { ACTIONS } from "../shared/actions";
import type {
  ActionId,
  Capture,
  PasteResult,
  Permissions,
  Settings,
  SettingsUpdate,
} from "../shared/types";
import "./styles.css";

const api = window.snapPaste;
const icons: Record<ActionId, typeof FileText> = {
  text: FileText,
  formatted: WandSparkles,
  spreadsheet: Table2,
  summary: LayoutGrid,
  "bug-report": Code2,
  message: MessageSquare,
  receipt: Clipboard,
  event: LayoutGrid,
  custom: Sparkles,
};
const categoryNames = {
  table: "Table detected",
  code: "Developer content",
  receipt: "Receipt detected",
  event: "Event detected",
  document: "Text detected",
  unknown: "Image ready",
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

export default function App() {
  const [capture, setCapture] = useState<Capture | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [result, setResult] = useState<PasteResult | null>(null);
  const [activeAction, setActiveAction] = useState<ActionId | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [raw, setRaw] = useState(false);
  const [compact, setCompact] = useState(false);
  const captureRef = useRef<Capture | null>(null);
  const operation = useRef(0);
  const updateCapture = useCallback((value: Capture | null) => {
    if (!value || captureRef.current?.id !== value.id) {
      operation.current++;
      setResult(null);
      setActiveAction(null);
      setCustomOpen(false);
      setBusy(null);
    }
    captureRef.current = value;
    setCapture(value ? { ...value } : null);
  }, []);
  useEffect(() => {
    if (!api) {
      setError(
        "Open SnapPaste as a desktop app with npm start. Clipboard and native features are available in the desktop app.",
      );
      return;
    }
    void api
      .getSettings()
      .then(setSettings)
      .catch((e) => setError(errorMessage(e)));
    void api.getCapture().then((value) => {
      if (value) updateCapture(value);
    });
    const stops = [
      api.onCapture(updateCapture),
      api.onNotice(setError),
      api.onSettings(() => setSettingsOpen(true)),
      api.onMode(setCompact),
    ];
    return () => stops.forEach((stop) => stop());
  }, [updateCapture]);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(""), 2800);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  async function load(kind: "clipboard" | "import" | "screen" | "example") {
    setError("");
    setBusy("Opening image");
    try {
      await {
        clipboard: api.readClipboard,
        import: api.importImage,
        screen: api.captureScreen,
        example: api.loadExample,
      }[kind]();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy((current) => (current === "Opening image" ? null : current));
    }
  }
  async function run(action: ActionId, customInstruction = "") {
    if (!capture) return;
    if (action === "custom" && !customInstruction.trim()) {
      setCustomOpen(true);
      return;
    }
    if (
      ACTIONS[action].cloud &&
      (!settings?.cloudEnabled || !settings.hasOpenAIKey)
    ) {
      setError(
        "Add your OpenAI key and enable cloud processing to use AI actions. Just the text works without a key.",
      );
      setSettingsOpen(true);
      return;
    }
    const job = ++operation.current;
    setActiveAction(action);
    setBusy(
      action === "text" ? "Reading text on your Mac" : "Preparing your result",
    );
    setError("");
    setRaw(false);
    try {
      const value = await api.generate(capture.id, action, customInstruction);
      if (job === operation.current) {
        setResult(value);
        setCustomOpen(false);
      }
    } catch (e) {
      if (job === operation.current) setError(errorMessage(e));
    } finally {
      if (job === operation.current) setBusy(null);
    }
  }
  async function cancel() {
    operation.current++;
    await api.cancel();
    setBusy(null);
  }
  async function transfer(paste: boolean) {
    if (!result) return;
    try {
      setError("");
      await (paste ? api.paste(result) : api.copy(result));
      setToast(paste ? "Paste sent to your app" : "Copied. Ready to paste.");
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (settingsOpen) return;
      const editing =
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        (event.target instanceof HTMLElement && event.target.isContentEditable);
      if (event.key === "Escape") {
        if (busy) void cancel();
        else if (result) setResult(null);
        else if (customOpen) setCustomOpen(false);
        else void api?.hide();
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && result) {
        event.preventDefault();
        void transfer(true);
      }
      if (
        !editing &&
        !busy &&
        !result &&
        capture?.phase === "ready" &&
        /^[1-4]$/.test(event.key)
      ) {
        event.preventDefault();
        const action = capture.analysis.actions[Number(event.key) - 1];
        if (action) void run(action.id);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });
  const isReading = capture?.phase === "reading";
  const actions = capture?.analysis.actions ?? [
    ACTIONS.text,
    ACTIONS.formatted,
    ACTIONS.spreadsheet,
    ACTIONS.custom,
  ];

  return (
    <div className={`app-shell ${compact ? "compact" : ""}`}>
      <header className="titlebar">
        <div className="brand">
          <span className="brand-mark">
            <ClipboardPaste size={18} />
          </span>
          <span>
            SnapPaste<span className="beta">BETA</span>
          </span>
        </div>
        <div className="header-tools">
          <span className="shortcut-label">
            Smart paste{" "}
            <kbd>
              {prettyShortcut(settings?.shortcut ?? "CommandOrControl+Alt+V")}
            </kbd>
          </span>
          {compact && (
            <button
              className="icon-button"
              aria-label="Expand workspace"
              title="Expand workspace"
              onClick={() => void api.expand()}
            >
              <Maximize2 size={15} />
            </button>
          )}
          <button
            className="icon-button"
            aria-label="Open settings"
            title="Settings"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 size={17} />
          </button>
        </div>
      </header>
      <main>
        <section className="intro">
          <div>
            <div className="eyebrow">
              <span className="tiny-dot" /> A LITTLE LESS COPY. A LOT MORE
              PASTE.
            </div>
            <h1>
              Your screenshot. <span>Your next step.</span>
            </h1>
            <p>Capture what you see. Paste what you need.</p>
          </div>
          <span className="version-chip">
            MADE FOR MAC <Command size={12} />
          </span>
        </section>
        {error && (
          <div className="notice error" role="alert">
            <span>{error}</span>
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              <X size={14} />
            </button>
          </div>
        )}
        {capture?.analysis.warning && !error && (
          <div className="notice warning" role="status">
            <span>{capture.analysis.warning}</span>
          </div>
        )}
        {compact && (
          <div className="compact-source">
            {capture ? (
              <>
                <img src={capture.dataUrl} alt="Current screenshot" />
                <div>
                  <strong>{capture.name}</strong>
                  <span>
                    {isReading
                      ? "Reading screenshot…"
                      : categoryNames[capture.analysis.category]}{" "}
                    ·{" "}
                    {capture.analysis.source === "jev" ? "Jev" : "Local rules"}
                  </span>
                </div>
              </>
            ) : (
              <>
                <Clipboard size={20} />
                <div>
                  <strong>Copy an image to get started</strong>
                  <span>Then invoke smart paste again.</span>
                </div>
              </>
            )}
            <button
              className="icon-button"
              aria-label="Import a different image"
              onClick={() => void load("import")}
            >
              <ImagePlus size={16} />
            </button>
          </div>
        )}
        <div className="workspace">
          <section className="source-panel">
            <div className="panel-heading">
              <span>
                <span className="step-number">01</span> THE SOURCE
              </span>
              {capture && (
                <button
                  className="text-button"
                  disabled={!!busy || isReading}
                  onClick={() => void load("import")}
                >
                  Replace <ImagePlus size={13} />
                </button>
              )}
            </div>
            <div className={`image-stage ${capture ? "has-image" : ""}`}>
              {capture ? (
                <>
                  <div className="image-surface">
                    <img src={capture.dataUrl} alt={capture.name} />
                  </div>
                  <span className="image-dimension">
                    {capture.width} × {capture.height}
                  </span>
                </>
              ) : (
                <div className="empty-source">
                  <div className="capture-art">
                    <div className="art-card back" />
                    <div className="art-card front">
                      <span />
                      <span />
                      <span />
                      <div className="art-cursor">
                        <ArrowDownLeft size={20} />
                      </div>
                    </div>
                    <span className="scan-corner tl" />
                    <span className="scan-corner tr" />
                    <span className="scan-corner bl" />
                    <span className="scan-corner br" />
                  </div>
                  <h2>Start with something you see.</h2>
                  <p>
                    A table. An error. A tiny detail.
                    <br />
                    We’ll help you get it out of the image.
                  </p>
                  <button
                    className="primary-button"
                    disabled={!!busy}
                    onClick={() => void load("clipboard")}
                  >
                    <Clipboard size={16} /> Use clipboard image
                  </button>
                  <button
                    className="text-button example-button"
                    disabled={!!busy}
                    onClick={() => void load("example")}
                  >
                    Or try an example <ArrowRight size={13} />
                  </button>
                </div>
              )}
            </div>
            <div className="source-bottom">
              {capture ? (
                <>
                  <div className="file-info">
                    <div className="file-icon">
                      <ImagePlus size={16} />
                    </div>
                    <div>
                      <strong title={capture.name}>{capture.name}</strong>
                      <span>PNG · {(capture.bytes / 1024).toFixed(0)} KB</span>
                    </div>
                    {isReading ? (
                      <LoaderCircle className="spin muted" size={15} />
                    ) : (
                      <Check className="green" size={16} />
                    )}
                  </div>
                  <div className="detection">
                    <span>
                      <span
                        className={`tiny-dot ${isReading ? "pulse" : ""}`}
                      />
                      {isReading
                        ? "Reading your screenshot…"
                        : categoryNames[capture.analysis.category]}
                    </span>
                    <span className="source-label">
                      {capture.analysis.source === "jev"
                        ? "JEV · EXPERIMENTAL"
                        : "LOCAL RULES"}
                    </span>
                  </div>
                </>
              ) : (
                <div className="capture-hint">
                  <Scan size={15} />
                  <span>
                    Copy a region with <kbd>⌃ ⌘ ⇧ 4</kbd>
                  </span>
                </div>
              )}
            </div>
            <div className="source-toolbar">
              <button
                disabled={!!busy || isReading}
                onClick={() => void load("screen")}
              >
                <Scan size={15} /> Capture region
              </button>
              <button
                disabled={!!busy || isReading}
                onClick={() => void load("import")}
              >
                <ImagePlus size={15} /> Open image
              </button>
              {capture && (
                <button
                  title="Read a new clipboard image"
                  aria-label="Read clipboard image"
                  disabled={!!busy || isReading}
                  onClick={() => void load("clipboard")}
                >
                  <Clipboard size={15} />
                </button>
              )}
            </div>
          </section>
          <section className="destination-panel">
            <div className="panel-heading">
              <span>
                <span className="step-number">02</span>{" "}
                {result ? "YOUR RESULT" : "MAKE IT USEFUL"}
              </span>
              <span className="subtle-label">
                {result ? "CHECK · EDIT · PASTE" : "FOUR WAYS FORWARD"}
              </span>
            </div>
            {result ? (
              <div className="result-view">
                <div className="result-heading">
                  <button
                    className="back-button"
                    onClick={() => setResult(null)}
                  >
                    <ArrowLeft size={14} /> Actions
                  </button>
                  <span className="result-source">
                    {result.source === "Apple Vision" ? (
                      <Monitor size={12} />
                    ) : (
                      <Sparkles size={12} />
                    )}{" "}
                    {result.source} · {(result.elapsedMs / 1000).toFixed(1)}s
                  </span>
                </div>
                <div className="result-title-row">
                  <h2>{ACTIONS[result.actionId].title}</h2>
                  {result.kind === "text" && (
                    <div className="segmented">
                      <button
                        className={!raw ? "selected" : ""}
                        onClick={() => setRaw(false)}
                      >
                        Preview
                      </button>
                      <button
                        className={raw ? "selected" : ""}
                        onClick={() => setRaw(true)}
                      >
                        Edit
                      </button>
                    </div>
                  )}
                </div>
                <div className="result-content">
                  {result.kind === "table" ? (
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            {result.headers.map((cell, i) => (
                              <th key={i}>
                                <input
                                  aria-label={`Column ${i + 1} heading`}
                                  value={cell}
                                  onChange={(e) =>
                                    setResult({
                                      ...result,
                                      headers: result.headers.map((c, j) =>
                                        j === i ? e.target.value : c,
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
                  ) : raw ? (
                    <textarea
                      className="result-editor"
                      aria-label="Edit extracted text"
                      value={result.text}
                      onChange={(e) =>
                        setResult({ ...result, text: e.target.value })
                      }
                    />
                  ) : (
                    <div className="markdown">
                      {result.actionId === "text" ? (
                        <pre className="plain-text">{result.text}</pre>
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
                </div>
                {result.notes.length > 0 && (
                  <div className="result-notes">
                    <strong>Worth checking</strong>
                    {result.notes.map((note, i) => (
                      <p key={i}>{note}</p>
                    ))}
                  </div>
                )}
                <div className="result-caption">
                  {result.kind === "table"
                    ? "Click any cell to edit. Copies as spreadsheet cells and a formatted table."
                    : "Review before pasting. Use Edit to make it yours."}
                </div>
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
                    <ClipboardPaste size={15} /> Paste into app <kbd>⌘ ↵</kbd>
                  </button>
                </div>
              </div>
            ) : (
              <div className="actions-view">
                <div className="actions-intro">
                  <h2>How would you like to paste?</h2>
                  <p>
                    {capture
                      ? "Same screenshot. A more useful format."
                      : "Your image becomes something you can work with."}
                  </p>
                </div>
                <div className={`action-list ${!capture ? "waiting" : ""}`}>
                  {actions.map((action, index) => {
                    const Icon = icons[action.id];
                    return (
                      <button
                        key={action.id}
                        className={`action-card ${activeAction === action.id && busy ? "working" : ""}`}
                        disabled={!capture || !!busy || isReading}
                        onClick={() => void run(action.id)}
                      >
                        <span
                          className={`action-icon ${action.id === "text" ? "local-icon" : ""}`}
                        >
                          <Icon size={19} />
                        </span>
                        <span className="action-copy">
                          <span className="action-title">
                            {action.title}
                            <span
                              className={`action-badge ${action.cloud ? "" : "local"}`}
                            >
                              {action.cloud ? (
                                <Sparkles size={9} />
                              ) : (
                                <Zap size={9} />
                              )}{" "}
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
                {busy && capture ? (
                  <div className="busy-row" role="status">
                    <LoaderCircle className="spin" size={15} />
                    <span>{busy}…</span>
                    <button onClick={() => void cancel()}>Cancel</button>
                  </div>
                ) : (
                  <>
                    <div className="custom-divider">
                      <span>OR MAKE IT YOURS</span>
                    </div>
                    {customOpen ? (
                      <div className="custom-box">
                        <textarea
                          autoFocus
                          aria-label="Custom instruction"
                          placeholder="e.g. Extract only the product names and monthly prices"
                          value={instruction}
                          maxLength={4000}
                          onChange={(e) => setInstruction(e.target.value)}
                        />
                        <div>
                          <button
                            className="text-button"
                            onClick={() => setCustomOpen(false)}
                          >
                            Cancel
                          </button>
                          <button
                            className="primary-button small"
                            disabled={!instruction.trim()}
                            onClick={() => void run("custom", instruction)}
                          >
                            Create result <ArrowRight size={13} />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        className="custom-trigger"
                        disabled={!capture || isReading}
                        onClick={() => setCustomOpen(true)}
                      >
                        <span>
                          <Sparkles size={15} /> Give a custom instruction
                        </span>
                        <ArrowRight size={14} />
                      </button>
                    )}
                    {settings && settings.prompts.length > 0 && (
                      <select
                        className="prompt-select"
                        aria-label="Saved prompts"
                        value=""
                        disabled={!capture || isReading}
                        onChange={(e) => {
                          const prompt = settings.prompts.find(
                            (p) => p.id === e.target.value,
                          );
                          if (prompt) {
                            setInstruction(prompt.instruction);
                            setCustomOpen(true);
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
                  </>
                )}
              </div>
            )}
          </section>
        </div>
      </main>
      <footer>
        <span>
          <ShieldCheck size={13} />
          {settings?.cloudEnabled
            ? "Cloud processing enabled"
            : "Local by default. AI when you choose."}
        </span>
        <span>
          <kbd>esc</kbd> to dismiss <span className="footer-separator">·</span>{" "}
          <kbd>1–4</kbd> to choose
        </span>
      </footer>
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
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
              <div className="cloud-setting">
                <div>
                  <strong>Enable cloud processing</strong>
                  <p>
                    Jev receives the captured image to suggest actions. OpenAI
                    receives it when you select an AI action.
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
                  Without Jev, suggestions use simple local text rules, clearly
                  labeled.
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
                storage. Screenshots are not kept in a history.
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
