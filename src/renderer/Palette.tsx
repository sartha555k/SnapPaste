import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  Code2,
  Crop,
  FileText,
  Image,
  LoaderCircle,
  PenLine,
  RotateCw,
  Sparkles,
  Table2,
  X,
  Zap,
} from "lucide-react";
import { ACTIONS } from "../shared/actions";
import {
  CUSTOM_PASTE,
  TOGETHER_FALLBACK,
  TOGETHER_TEXT,
} from "../shared/paste-together";
import type {
  Capture,
  PaletteOpen,
  PasteAction,
  PasteResult,
} from "../shared/types";
import "./palette.css";
const api = window.snapPaste;
const errorText = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).replace(
    /^Error invoking remote method '[^']+': Error: /,
    "",
  );
const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  return s < 60
    ? "Just captured"
    : s < 3600
      ? `${Math.floor(s / 60)} min ago`
      : new Date(iso).toLocaleDateString();
};
type Region = { x: number; y: number; width: number; height: number };
export default function Palette() {
  const [open, setOpen] = useState<PaletteOpen | null>(null);
  const [index, setIndex] = useState(0);
  const [together, setTogether] = useState(false);
  const [ids, setIds] = useState<string[]>([]);
  const [match, setMatch] =
    useState<Awaited<ReturnType<typeof api.paletteMatch>>>();
  const [writing, setWriting] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [capture, setCapture] = useState<Capture | null>(null);
  const [selected, setSelected] = useState(0);
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<PasteResult | null>(null);
  const [cropping, setCropping] = useState(false);
  const [region, setRegion] = useState<Region | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const session = useRef(0);
  const item = open?.items[index];
  const current = capture && item?.id === capture.id ? capture : null;
  const ready = current?.phase === "ready";
  const matching =
    together && !!open?.cloudReady && ids.length >= 2 && match === undefined;
  const rows: (PasteAction | null)[] = together
    ? [
        TOGETHER_TEXT,
        ...(matching
          ? [null, null, null]
          : (match?.actions ?? TOGETHER_FALLBACK)),
        CUSTOM_PASTE,
      ]
    : [
        current?.analysis.actions[0] ?? ACTIONS.text,
        ...(ready ? current.analysis.actions.slice(1, 4) : [null, null, null]),
        CUSTOM_PASTE,
      ];
  const sourceIds = together ? ids : item ? [item.id] : [];
  const cloudHint =
    "Enable cloud processing and add your OpenAI key in Settings.";
  function chooseSources(next: string[]) {
    setIds(next);
    setMatch(undefined);
    setResult(null);
    setError("");
    setSelected(0);
  }
  function latest(count: number, state = open) {
    return (
      state?.items
        .slice(0, count)
        .reverse()
        .map((shot) => shot.id) ?? []
    );
  }
  useEffect(() => {
    if (!together || !open?.cloudReady || ids.length < 2 || match) return;
    const token = session.current;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void api.paletteMatch(ids).then(
        (next) => {
          if (!cancelled && token === session.current) setMatch(next);
        },
        (error) => {
          if (!cancelled && token === session.current)
            setMatch({
              title: "General options",
              actions: TOGETHER_FALLBACK,
              warning: errorText(error),
            });
        },
      );
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [together, open, ids, match]);
  async function runGeneratedAction(action: PasteAction, prompt?: string) {
    if (working) return;
    const token = session.current;
    setWorking(action.title);
    setError("");
    try {
      const next = await api.paletteGenerate(sourceIds, action.id, prompt);
      if (token === session.current && typeof next === "object") {
        setResult(next);
        setWriting(false);
      }
    } catch (e) {
      if (token === session.current) setError(errorText(e));
    } finally {
      if (token === session.current) setWorking("");
    }
  }
  useLayoutEffect(() => {
    document.documentElement.classList.add("palette");
  }, []);
  useEffect(() => {
    const off = [
      api.onPaletteOpen((state) => {
        session.current++;
        setOpen(state);
        setTogether(state.together);
        setIds(state.groupIds.length ? state.groupIds : latest(2, state));
        setMatch(state.groupMenu);
        setWriting(false);
        setInstruction("");
        setIndex(0);
        setSelected(0);
        setWorking("");
        setError("");
        setCapture(null);
        setResult(null);
        setCropping(false);
        setRegion(null);
      }),
      api.onCapture(setCapture),
    ];
    return () => off.forEach((f) => f());
  }, []);
  // Reopening the window can leave the content at the same measured height.
  // Send it explicitly because ResizeObserver only reports changes.
  useLayoutEffect(() => {
    if (!open || !root.current) return;
    if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
    void api.paletteResize(Math.ceil(root.current.offsetHeight));
  }, [open, writing, result?.kind, cropping]);
  useEffect(() => {
    if (!root.current) return;
    const observer = new ResizeObserver(() => {
      if (root.current)
        void api.paletteResize(Math.ceil(root.current.offsetHeight));
    });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  async function run(row: number) {
    const action = rows[row];
    if (!action || working || !item) return;
    setSelected(row);
    if (together && sourceIds.length < 2) {
      setError("Select two or three screenshots.");
      return;
    }
    if (
      (together || action.id === CUSTOM_PASTE.id) &&
      action.cloud &&
      !open?.cloudReady
    ) {
      setError(cloudHint);
      return;
    }
    if (action.id === CUSTOM_PASTE.id) {
      setInstruction("");
      setWriting(true);
      setError("");
      return;
    }
    if (together) {
      await runGeneratedAction(action);
      return;
    }
    if (!current || current.phase === "reading") return;
    if (action.id === "select_region") {
      setCropping(true);
      setRegion(null);
      setError("");
      return;
    }
    const token = session.current;
    setSelected(row);
    setError("");
    setWorking(action.title);
    try {
      const outcome = await api.paletteRun(current.id, action.id);
      if (token === session.current && typeof outcome === "object")
        setResult(outcome.result);
    } catch (e) {
      if (token === session.current) setError(errorText(e));
    } finally {
      if (token === session.current) setWorking("");
    }
  }
  async function transfer(value?: string) {
    if (!result || working) return;
    setWorking("Pasting");
    setError("");
    try {
      await api.palettePaste({
        ...result,
        text: value ?? result.text,
        values: [],
      });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setWorking("");
    }
  }
  function show(next: number) {
    if (!open || working || next < 0 || next >= open.items.length) return;
    session.current++;
    setIndex(next);
    setSelected(0);
    setError("");
    setResult(null);
    setCropping(false);
    void api
      .paletteSelect(open.items[next].id)
      .catch((e) => setError(errorText(e)));
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        session.current++;
        if (result) {
          setResult(null);
          setWorking("");
        } else if (writing && !working) {
          setWriting(false);
          setError("");
        } else if (cropping) setCropping(false);
        else void api.paletteClose();
        return;
      }
      if (
        working ||
        result ||
        cropping ||
        writing ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        e.isComposing
      )
        return;
      if (e.target instanceof HTMLButtonElement && e.key === "Enter") return;
      if (together && e.key === "Tab") return;
      if (["ArrowDown", "ArrowUp", "Tab"].includes(e.key)) {
        e.preventDefault();
        const d =
          e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey) ? -1 : 1;
        const available = rows.flatMap((action, i) => (action ? [i] : []));
        setSelected(
          (s) =>
            available[
              (available.indexOf(s) + d + available.length) % available.length
            ],
        );
      } else if (!together && e.key === "ArrowRight") show(index + 1);
      else if (!together && e.key === "ArrowLeft") show(index - 1);
      else if (e.key === "Enter") {
        e.preventDefault();
        void run(selected);
      } else if (/^[1-5]$/.test(e.key)) {
        e.preventDefault();
        void run(Number(e.key) - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  function point(e: React.PointerEvent<HTMLImageElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    };
  }
  async function crop() {
    if (!current || !region || working) return;
    setWorking("Reading selected region");
    setError("");
    try {
      await api.cropCapture(current.id, region);
      const next = await api.getCapture();
      if (next) {
        setOpen((o) =>
          o
            ? {
                ...o,
                items: [
                  {
                    id: next.id,
                    name: next.name,
                    thumbnail: next.dataUrl,
                    createdAt: new Date().toISOString(),
                  },
                  ...o.items,
                ],
              }
            : o,
        );
        setIndex(0);
        setCapture(next);
      }
      setCropping(false);
      setRegion(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setWorking("");
    }
  }
  return (
    <div className={`sp-palette${together ? " sp-together" : ""}`} ref={root}>
      <div className="sp-brand">
        <span>
          <span className="sp-mark" aria-hidden="true">
            <ClipboardPaste size={13} />
          </span>
          SnapPaste
        </span>
        <button
          aria-label="Close paste menu"
          onClick={() => void api.paletteClose()}
        >
          <X size={13} />
        </button>
      </div>
      {!item ? (
        <div className="sp-empty">
          <Image size={25} />
          <strong>Your next paste starts here</strong>
          <span>Take a screenshot, then press your smart-paste shortcut.</span>
          <button onClick={() => void api.paletteLibrary()}>
            Open library
          </button>
        </div>
      ) : (
        <>
          {together ? (
            <section
              className="sp-group"
              aria-label="Choose screenshots to paste together"
            >
              <div className="sp-group-heading">
                <div className="sp-group-title">
                  <strong>Paste together</strong>
                  <span>{ids.length} selected</span>
                </div>
                <button
                  disabled={!!working || writing || !!result}
                  onClick={() => chooseSources(latest(2))}
                >
                  Latest 2
                </button>
                <button
                  disabled={
                    !!working || writing || !!result || open!.items.length < 3
                  }
                  onClick={() => chooseSources(latest(3))}
                >
                  Latest 3
                </button>
                {ids.length > 1 && (
                  <button
                    className="sp-order"
                    aria-label="Rotate selection order"
                    title="Rotate selection order"
                    disabled={!!working || writing || !!result}
                    onClick={() => chooseSources([...ids.slice(1), ids[0]])}
                  >
                    <RotateCw size={13} />
                  </button>
                )}
              </div>
              <div className="sp-thumbnails">
                {open!.items.map((shot) => (
                  <button
                    key={shot.id}
                    title={shot.name}
                    aria-label={shot.name}
                    aria-pressed={ids.includes(shot.id)}
                    disabled={
                      !!working ||
                      writing ||
                      !!result ||
                      (ids.length === 3 && !ids.includes(shot.id))
                    }
                    onClick={() =>
                      chooseSources(
                        ids.includes(shot.id)
                          ? ids.filter((id) => id !== shot.id)
                          : [...ids, shot.id],
                      )
                    }
                  >
                    <img src={shot.thumbnail} alt="" />
                    {ids.includes(shot.id) && (
                      <kbd>{ids.indexOf(shot.id) + 1}</kbd>
                    )}
                  </button>
                ))}
              </div>
              {ids.length < 2 && (
                <p>Pick two or three screenshots from history.</p>
              )}
            </section>
          ) : (
            <header className="sp-head">
              <img src={item.thumbnail} alt="Recent screenshot" />
              <div className="sp-meta">
                <strong>
                  {ready
                    ? (current.analysis.subcategoryTitle ?? "Screenshot")
                    : "Getting your screenshot ready"}
                </strong>
                <span>
                  {ago(item.createdAt)} · {item.name}
                </span>
              </div>
              <div className="sp-nav">
                <button
                  disabled={index === 0 || !!working}
                  onClick={() => show(index - 1)}
                  aria-label="Newer screenshot"
                >
                  <ChevronLeft size={14} />
                </button>
                <span>
                  {index + 1}/{open!.items.length}
                </span>
                <button
                  disabled={index === open!.items.length - 1 || !!working}
                  onClick={() => show(index + 1)}
                  aria-label="Older screenshot"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </header>
          )}
          {writing ? (
            <form
              className="sp-preview"
              onSubmit={(e) => {
                e.preventDefault();
                if (instruction.trim())
                  void runGeneratedAction(CUSTOM_PASTE, instruction.trim());
              }}
            >
              <button
                type="button"
                className="sp-back"
                disabled={!!working}
                onClick={() => {
                  setWriting(false);
                  setError("");
                }}
              >
                <ArrowLeft size={13} /> Options
              </button>
              <p>
                Ask what to paste from{" "}
                {sourceIds.length === 1
                  ? "this screenshot"
                  : `these ${sourceIds.length} screenshots`}
                . Uses OpenAI.
              </p>
              <textarea
                autoFocus
                aria-label="Custom paste instruction"
                placeholder="Example: Make a table with only Math and English."
                value={instruction}
                maxLength={4000}
                disabled={!!working}
                onChange={(e) => setInstruction(e.target.value)}
              />
              <div className="sp-controls">
                <button
                  type="submit"
                  disabled={!instruction.trim() || !!working}
                >
                  Generate preview
                </button>
              </div>
            </form>
          ) : cropping ? (
            <div className="sp-crop">
              <p>Drag over the part you want to reuse.</p>
              <div className="sp-crop-frame">
                <div className="sp-crop-image">
                  <img
                    src={current?.dataUrl ?? item.thumbnail}
                    alt="Select screenshot region"
                    draggable={false}
                    onPointerDown={(e) => {
                      origin.current = point(e);
                      setRegion(null);
                      e.currentTarget.setPointerCapture(e.pointerId);
                    }}
                    onPointerMove={(e) => {
                      if (!origin.current) return;
                      const p = point(e),
                        o = origin.current;
                      setRegion({
                        x: Math.min(p.x, o.x),
                        y: Math.min(p.y, o.y),
                        width: Math.abs(p.x - o.x),
                        height: Math.abs(p.y - o.y),
                      });
                    }}
                    onPointerUp={() => {
                      origin.current = null;
                    }}
                  />
                  {region && (
                    <div
                      className="sp-selection"
                      style={{
                        left: `${region.x * 100}%`,
                        top: `${region.y * 100}%`,
                        width: `${region.width * 100}%`,
                        height: `${region.height * 100}%`,
                      }}
                    />
                  )}
                </div>
              </div>
              <div className="sp-controls">
                <button onClick={() => setCropping(false)}>Back</button>
                <button
                  disabled={
                    !region ||
                    region.width < 0.01 ||
                    region.height < 0.01 ||
                    !!working
                  }
                  onClick={() => void crop()}
                >
                  Use selected region
                </button>
              </div>
            </div>
          ) : result ? (
            <div className="sp-preview">
              <button className="sp-back" onClick={() => setResult(null)}>
                <ArrowLeft size={13} /> Options
              </button>
              {result.values?.length ? (
                <>
                  <p>Choose the exact value to paste</p>
                  <div className="sp-values">
                    {result.values.map((v, i) => (
                      <button
                        key={i}
                        disabled={!!working}
                        onClick={() => void transfer(v.value)}
                      >
                        <small>{v.label}</small>
                        <span>{v.value}</span>
                        <kbd>↵</kbd>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  {result.kind === "table" ? (
                    <div className="sp-table-preview">
                      <table>
                        <thead>
                          <tr>
                            {result.headers.map((cell, i) => (
                              <th key={i}>{cell}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {result.rows.map((row, i) => (
                            <tr key={i}>
                              {row.map((cell, j) => (
                                <td key={j}>{cell}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <textarea
                      aria-label="Edit extracted text before pasting"
                      value={result.text}
                      onChange={(e) =>
                        setResult({ ...result, text: e.target.value })
                      }
                    />
                  )}
                  {!!result.notes.length && (
                    <p className="sp-result-notes">
                      {result.notes.join(" · ")}
                    </p>
                  )}
                  <div className="sp-controls">
                    <button
                      disabled={!!working}
                      onClick={() => void transfer()}
                    >
                      {result.kind === "table" ? "Paste table" : "Paste text"}
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <>
              <div className="sp-section-label">
                PASTE AS{" "}
                <span>
                  {together
                    ? matching
                      ? "Matching screenshots…"
                      : (match?.title ??
                        (open?.cloudReady
                          ? "Multiple screenshots"
                          : "Cloud processing unavailable"))
                    : ready && current.analysis.source === "local"
                      ? "General menu"
                      : ready
                        ? "Matched to this screenshot"
                        : "Local text is available first"}
                </span>
              </div>
              {together && match?.warning && (
                <p className="sp-match-warning" role="status">
                  {match.warning}
                </p>
              )}
              <ul
                className="sp-rows"
                role="listbox"
                aria-label="Screenshot paste options"
              >
                {rows.map((action, row) => {
                  if (!action)
                    return (
                      <li className="sp-row sp-loading" key={row}>
                        <span className="sp-icon">
                          <Sparkles size={15} />
                        </span>
                        <span className="sp-text">
                          <span className="sp-bar" />
                          <span className="sp-bar sp-short" />
                        </span>
                      </li>
                    );
                  const Icon =
                    action.id === CUSTOM_PASTE.id
                      ? PenLine
                      : action.icon === "table"
                        ? Table2
                        : action.icon === "code"
                          ? Code2
                          : action.id === "select_region"
                            ? Crop
                            : action.id === "original"
                              ? Image
                              : action.id === "text"
                                ? FileText
                                : Sparkles;
                  const cached = current?.preparedActions?.includes(action.id);
                  const preparing = current?.preparingActions?.includes(
                    action.id,
                  );
                  return (
                    <li
                      key={action.id}
                      role="option"
                      aria-selected={row === selected}
                      aria-disabled={
                        !!working ||
                        (together
                          ? ids.length < 2
                          : action.id !== CUSTOM_PASTE.id &&
                            (!current || current.phase === "reading"))
                      }
                      className={`sp-row${row === selected ? " sp-on" : ""}${action.id === CUSTOM_PASTE.id ? " sp-custom" : ""}`}
                      onMouseEnter={() => setSelected(row)}
                      onClick={() => void run(row)}
                    >
                      <span
                        className={`sp-icon ${!action.cloud ? "sp-local" : ""}`}
                      >
                        <Icon size={16} />
                      </span>
                      <span className="sp-text">
                        <strong>{action.title}</strong>
                        <small>
                          {cached
                            ? "Prepared · ready to paste"
                            : preparing
                              ? "Preparing in the background"
                              : action.description}
                        </small>
                      </span>
                      <span
                        className={`sp-badge ${!action.cloud ? "sp-badge-local" : ""}`}
                      >
                        {cached ? (
                          <Check size={10} />
                        ) : preparing ? (
                          <LoaderCircle size={10} className="sp-spin" />
                        ) : !action.cloud ? (
                          <Zap size={10} />
                        ) : null}
                        {cached
                          ? "Ready"
                          : preparing
                            ? "Preparing"
                            : action.cloud
                              ? action.localFirst
                                ? "Local / AI"
                                : "AI"
                              : "Local"}
                      </span>
                      <kbd>{row + 1}</kbd>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {working && (
            <div className="sp-progress" role="status">
              <LoaderCircle size={13} className="sp-spin" />
              {working}…
            </div>
          )}
          {error && (
            <p className="sp-error" role="alert">
              {error}
            </p>
          )}
          <footer className="sp-foot">
            <span>
              {open!.trusted ? (
                <>
                  <kbd>↵</kbd> paste <kbd>↑↓</kbd> choose
                </>
              ) : (
                <button
                  onClick={() => void api.openPermission("accessibility")}
                >
                  Enable automatic paste
                </button>
              )}
            </span>
            {!together &&
              open!.items.length > 1 &&
              !working &&
              !writing &&
              !result &&
              !cropping && (
                <button
                  onClick={() => {
                    chooseSources(latest(2));
                    setTogether(true);
                  }}
                >
                  Paste together
                </button>
              )}
            <button onClick={() => void api.paletteLibrary()}>Library ↗</button>
          </footer>
        </>
      )}
    </div>
  );
}
