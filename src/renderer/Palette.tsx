import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Calendar,
  ChartNoAxesCombined,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  Code2,
  FileText,
  LayoutGrid,
  LoaderCircle,
  MessageSquare,
  PanelsTopLeft,
  Sparkles,
  Table2,
} from "lucide-react";
import { ACTIONS, CATEGORIES } from "../shared/actions";
import type { Capture, PaletteOpen, PasteAction } from "../shared/types";
import "./palette.css";

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
const errorText = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).replace(
    /^Error invoking remote method '[^']+': Error: /,
    "",
  );
function ago(iso: string) {
  const seconds = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

/** The inline menu that opens next to the caret on the paste shortcut. */
export default function Palette() {
  const [open, setOpen] = useState<PaletteOpen | null>(null);
  const [index, setIndex] = useState(0);
  const [capture, setCapture] = useState<Capture | null>(null);
  const [selected, setSelected] = useState(0);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const item = open?.items[index];

  useLayoutEffect(() => {
    document.documentElement.classList.add("palette");
  }, []);
  useEffect(() => {
    const off = [
      api.onPaletteOpen((state) => {
        setOpen(state);
        setIndex(0);
        setSelected(0);
        setWorking(null);
        setError("");
        setCapture(null);
      }),
      api.onCapture(setCapture),
    ];
    return () => off.forEach((unsubscribe) => unsubscribe());
  }, []);
  // Size the native panel to the content.
  useEffect(() => {
    if (!root.current) return;
    const observer = new ResizeObserver(() => {
      if (root.current)
        void api.paletteResize(Math.ceil(root.current.offsetHeight));
    });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);

  const current = capture && item && capture.id === item.id ? capture : null;
  const ready = current?.phase === "ready";
  const ai = (current?.analysis.actions ?? []).filter((a) => a.id !== "text");
  const rows: (PasteAction | null)[] = [
    ACTIONS.text,
    ...(ready ? ai.slice(0, 3) : [null, null, null]),
  ];
  const category = current && ready ? CATEGORIES[current.analysis.category] : null;

  async function run(row: number) {
    const action = rows[row];
    if (!action || !item || working) return;
    if (action.id === "text" && !current?.ocrText && current?.phase === "reading")
      return; // OCR still running; the row shows a spinner.
    setSelected(row);
    setError("");
    setWorking(action.title);
    try {
      await api.paletteRun(item.id, action.id);
      setWorking(null);
    } catch (e) {
      setWorking(null);
      setError(errorText(e));
    }
  }
  function show(next: number) {
    if (!open || working || next < 0 || next >= open.items.length) return;
    setIndex(next);
    setSelected(0);
    setError("");
    void api.paletteSelect(open.items[next].id);
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setWorking(null);
        void api.paletteClose();
      } else if (working) return;
      else if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) {
        e.preventDefault();
        setSelected((s) => (s + 1) % rows.length);
      } else if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) {
        e.preventDefault();
        setSelected((s) => (s + rows.length - 1) % rows.length);
      } else if (e.key === "ArrowRight") show(index + 1);
      else if (e.key === "ArrowLeft") show(index - 1);
      else if (e.key === "Enter") void run(selected);
      else if (/^[1-4]$/.test(e.key)) void run(Number(e.key) - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (working)
    return (
      <div className="sp-palette sp-working" ref={root}>
        <LoaderCircle size={16} className="sp-spin" />
        <span className="sp-working-title">{working}…</span>
        <kbd>esc</kbd>
      </div>
    );
  return (
    <div className="sp-palette" ref={root}>
      {!open || !item ? (
        <div className="sp-empty">
          <strong>No screenshots yet</strong>
          <span>Capture one with ⌘⌥S, or copy an image, then paste again.</span>
        </div>
      ) : (
        <>
          <header className="sp-head">
            <img src={item.thumbnail} alt="" />
            <div className="sp-meta">
              <strong>{item.name}</strong>
              <span>
                {ago(item.createdAt)}
                {category ? ` · ${category.title}` : " · Reading…"}
                {ready && current?.analysis.source === "local" ? (
                  <em title={current.analysis.warning}> · local</em>
                ) : null}
              </span>
            </div>
            {open.items.length > 1 && (
              <div className="sp-nav">
                <button
                  disabled={index === 0}
                  onClick={() => show(index - 1)}
                  aria-label="Newer screenshot"
                >
                  <ChevronLeft size={14} />
                </button>
                <span>
                  {index + 1}/{open.items.length}
                </span>
                <button
                  disabled={index === open.items.length - 1}
                  onClick={() => show(index + 1)}
                  aria-label="Older screenshot"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            )}
          </header>
          <ul className="sp-rows" role="listbox">
            {rows.map((action, row) =>
              action ? (
                <li
                  key={action.id}
                  role="option"
                  aria-selected={row === selected}
                  className={row === selected ? "sp-row sp-on" : "sp-row"}
                  onMouseEnter={() => setSelected(row)}
                  onClick={() => void run(row)}
                >
                  <span className="sp-icon">
                    {React.createElement(icons[action.icon], { size: 15 })}
                  </span>
                  <span className="sp-text">
                    <strong>{action.title}</strong>
                    <small>{action.description}</small>
                  </span>
                  <kbd>{row + 1}</kbd>
                </li>
              ) : (
                <li key={`loading-${row}`} className="sp-row sp-loading">
                  <span className="sp-icon">
                    <Sparkles size={15} />
                  </span>
                  <span className="sp-text">
                    <span className="sp-bar" />
                    <span className="sp-bar sp-short" />
                  </span>
                </li>
              ),
            )}
          </ul>
          {error && <p className="sp-error">{error}</p>}
          <footer className="sp-foot">
            {open.trusted ? (
              <span>
                <kbd>↵</kbd> paste <kbd>↑↓</kbd> choose
                {open.items.length > 1 && (
                  <>
                    {" "}
                    <kbd>←→</kbd> screenshot
                  </>
                )}
              </span>
            ) : (
              <button onClick={() => void api.openPermission("accessibility")}>
                Allow Accessibility to paste automatically
              </button>
            )}
            <button className="sp-link" onClick={() => void api.paletteLibrary()}>
              Library
            </button>
          </footer>
        </>
      )}
    </div>
  );
}
