"use client";

import { useEffect, useRef, useState } from "react";
import {
  AnimatePresence,
  motion,
  MotionConfig,
  useReducedMotion,
} from "framer-motion";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCheck,
  ChevronRight,
  CircleAlert,
  Code2,
  Command,
  Download,
  ExternalLink,
  FileCode2,
  FileJson2,
  FileText,
  FolderOpen,
  GitBranch,
  Globe,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  Maximize2,
  Minimize2,
  Moon,
  Paintbrush,
  Pause,
  Play,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Terminal,
  Upload,
  X,
  Zap,
} from "lucide-react";
import type {
  Activity,
  Migration,
  Project,
  Report,
  StreamEvent,
} from "@/lib/types";
import BrowserHandoff from "./browser-handoff";
import {
  ActionButton,
  ChromeMark,
  FoxMark,
  PackageArt,
  Reveal,
} from "./motion-ui";
import { ChangedLines, CodeView, UnifiedDiff } from "./code-view";
import { LIMITS, UPLOAD_SIZE_LABEL } from "@/lib/limits";
import { lineReader } from "@/lib/ndjson";

type Config = {
  configured: boolean;
  analyst: string | null;
  engineer: string | null;
  budgetUsd: number;
  guardrail: string | null;
  accessRequired: boolean;
  directUploads?: boolean;
  aiAccessRequired?: boolean;
};
type History = {
  id: string;
  name: string;
  date: string;
  report: Report;
  patches: number;
  mode: "local" | "otari";
  status: string;
};
type View = "overview" | "report" | "workspace" | "export";
type Palette = "daylight" | "dusk" | "meadow";
const palettes: {
  id: Palette;
  name: string;
  detail: string;
  colors: string[];
}[] = [
  {
    id: "daylight",
    name: "Warm daylight",
    detail: "Cream · coral · lavender",
    colors: ["#f6f4ed", "#ed6548", "#d8cff2", "#26302d"],
  },
  {
    id: "dusk",
    name: "After hours",
    detail: "Graphite · peach · violet",
    colors: ["#1b2126", "#f2a58c", "#b4a0df", "#eee7da"],
  },
  {
    id: "meadow",
    name: "Garden studio",
    detail: "Linen · emerald · mint",
    colors: ["#f2f4ec", "#267c60", "#c6ded0", "#253c31"],
  },
];
const initialConfig: Config = {
  configured: false,
  analyst: null,
  engineer: null,
  budgetUsd: 0.5,
  guardrail: null,
  accessRequired: false,
};
const money = (value: number) => `$${value.toFixed(2)}`;
const size = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

function download(data: Blob, name: string) {
  const url = URL.createObjectURL(data);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function EnginePicker({
  mode,
  onChange,
  configured,
  compact = false,
}: {
  mode: "local" | "otari";
  onChange: (mode: "local" | "otari") => void;
  configured: boolean;
  compact?: boolean;
}) {
  return (
    <div
      className={`engine-picker ${compact ? "compact" : ""}`}
      role="radiogroup"
      aria-label="Migration engine"
    >
      <button
        type="button"
        role="radio"
        aria-checked={mode === "local"}
        onClick={() => onChange("local")}
      >
        <ShieldCheck size={16} />
        <span>Local rules{!compact && <small>Conservative & free</small>}</span>
        {mode === "local" && <Check size={13} />}
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={mode === "otari"}
        onClick={() => onChange("otari")}
        disabled={!configured}
        title={
          !configured
            ? "Configure two models in workspace settings first"
            : "Run the analyst and engineer through Otari"
        }
      >
        <Sparkles size={16} />
        <span>
          Otari AI
          {!compact && (
            <small>
              {configured
                ? "Two models, distinct roles"
                : "Connect in settings"}
            </small>
          )}
        </span>
        {mode === "otari" && <Check size={13} />}
      </button>
    </div>
  );
}

export default function Studio() {
  const [view, setView] = useState<View>("overview");
  const [config, setConfig] = useState<Config>(initialConfig);
  const [project, setProject] = useState<Project | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [originalReport, setOriginalReport] = useState<Report | null>(null);
  const [result, setResult] = useState<Migration | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [busy, setBusy] = useState<"import" | "migrate" | "export" | null>(
    null,
  );
  const [mode, setMode] = useState<"local" | "otari">("local");
  const [error, setError] = useState("");
  const [history, setHistory] = useState<History[]>([]);
  const [query, setQuery] = useState("");
  const [selectedFile, setSelectedFile] = useState("manifest.json");
  const [reportTab, setReportTab] = useState<
    "findings" | "apis" | "permissions"
  >("findings");
  const [importTab, setImportTab] = useState<"zip" | "github">("zip");
  const [githubUrl, setGithubUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [dragging, setDragging] = useState(false);
  const [modal, setModal] = useState<"settings" | "guide" | "history" | null>(
    null,
  );
  const [historyItem, setHistoryItem] = useState<History | null>(null);
  const [password, setPassword] = useState("");
  const [passwordDraft, setPasswordDraft] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const importer = useRef<HTMLElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const abort = useRef<AbortController | null>(null);
  const report = result?.report ?? originalReport;
  const blockers =
    report?.findings.filter((f) => f.severity === "blocked").length ?? 0;
  const headings: Record<View, string> = {
    overview: "Overview",
    report: "Compatibility report",
    workspace: "Migration workspace",
    export: "Export & install",
  };

  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then(setConfig)
      .catch(() => setError("Could not read gateway configuration."));
    try {
      const saved = JSON.parse(
        localStorage.getItem("bridgefox-history") ?? "[]",
      );
      if (Array.isArray(saved))
        setHistory(
          saved
            .filter(
              (h) =>
                h &&
                typeof h.name === "string" &&
                h.report &&
                Array.isArray(h.report.findings),
            )
            .slice(0, 20),
        );
    } catch {
      /* Corrupt local history is ignored. */
    }
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        setView("overview");
        searchInput.current?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
      abort.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (modal) dialog.current?.showModal();
    else dialog.current?.close();
  }, [modal]);

  function headers(json = false) {
    return {
      ...(json ? { "Content-Type": "application/json" } : {}),
      ...(password ? { "x-bridgefox-access": password } : {}),
    };
  }
  async function responseJson(response: Response) {
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error ?? `Request failed (${response.status})`);
    return data;
  }
  function acceptImport(data: { project: Project; report: Report; projectId?: string }) {
    setProject(data.project);
    setProjectId(data.projectId ?? null);
    setOriginalReport(data.report);
    setResult(null);
    setActivities([]);
    setFilePage(0);
    setSelectedFile(data.project.source?.manifestPath ?? "manifest.json");
    setView("report");
    setError("");
  }
  async function loadDemo() {
    if (busy) return;
    setBusy("import");
    setError("");
    try {
      acceptImport(
        await responseJson(
          await fetch("/api/demo", { method: "POST", headers: headers() }),
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the example.");
    } finally {
      setBusy(null);
    }
  }
  async function selectManifest(path: string) {
    if (!project?.source || busy || path === project.source.manifestPath) return;
    const manifest = project.files.find(f => f.path === path && f.encoding === "utf8");
    if (!manifest) return;
    setBusy("import");
    setError("");
    try {
      const selected = {
        ...project,
        source: { ...project.source, manifestPath: path },
        files: project.files.map(f => f.path === "manifest.json" ? { ...f, content: manifest.content } : f),
      };
      acceptImport(await responseJson(await fetch("/api/analyze", {
        method: "POST", headers: headers(true), body: JSON.stringify(projectId ? { projectId, manifestPath: path } : { project: selected }),
      })));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not analyze this manifest.");
    } finally { setBusy(null); }
  }
  async function upload(file?: File) {
    if (!file || busy) return;
    if (
      !file.name.toLowerCase().endsWith(".zip") ||
      file.size > LIMITS.upload
    ) {
      setError(`Choose an extension source ZIP of at most ${UPLOAD_SIZE_LABEL}.`);
      return;
    }
    setBusy("import");
    setError("");
    try {
      if (config?.directUploads) {
        const { uploadUrl } = await responseJson(await fetch("/api/upload", { method: "POST", headers: headers() }));
        const { storageId } = await responseJson(await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": "application/zip" }, body: file }));
        acceptImport(await responseJson(await fetch("/api/import", { method: "POST", headers: headers(true), body: JSON.stringify({ storageId, name: file.name }) })));
      } else {
        const form = new FormData();
        form.append("file", file);
        acceptImport(await responseJson(await fetch("/api/import", { method: "POST", headers: headers(), body: form })));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  async function importGithub(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy("import");
    setError("");
    try {
      acceptImport(
        await responseJson(
          await fetch("/api/github", {
            method: "POST",
            headers: headers(true),
            body: JSON.stringify({ url: githubUrl, branch }),
          }),
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "GitHub import failed.");
    } finally {
      setBusy(null);
    }
  }
  function saveHistory(migration: Migration) {
    const entry: History = {
      id: crypto.randomUUID(),
      name: migration.report.name,
      date: new Date().toISOString(),
      report: migration.report,
      patches: migration.patches.length,
      mode: migration.mode,
      status: migration.status,
    };
    setHistory((previous) => {
      const next = [entry, ...previous].slice(0, 20);
      try {
        localStorage.setItem("bridgefox-history", JSON.stringify(next));
      } catch {
        /* History is optional. */
      }
      return next;
    });
  }
  async function runMigration() {
    if (!project || busy) return;
    setBusy("migrate");
    setError("");
    setActivities([]);
    setResult(null);
    setView("workspace");
    const controller = new AbortController();
    abort.current = controller;
    let completed = false;
    try {
      const response = await fetch("/api/migrate", {
        method: "POST",
        headers: headers(true),
        body: JSON.stringify(projectId ? { projectId, mode } : { project, mode }),
        signal: controller.signal,
      });
      if (!response.ok) {
        await responseJson(response);
        return;
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Migration stream is unavailable.");
      const decoder = new TextDecoder();
      const consume = (line: string) => {
        if (!line.trim()) return;
        const event = JSON.parse(line) as StreamEvent;
        if (event.type === "activity")
          setActivities((previous) => [
            ...previous.filter((a) => a.id !== event.activity.id),
            event.activity,
          ]);
        if (event.type === "error") throw new Error(event.message);
        if (event.type === "result") {
          setResult(event.result);
          setActivities(event.result.activities);
          saveHistory(event.result);
          completed = true;
        }
      };
      const lines = lineReader(consume, LIMITS.request);
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        lines.push(decoder.decode(value, { stream: true }));
      }
      lines.push(decoder.decode());
      lines.finish();
      if (!completed)
        throw new Error("The migration stream ended before a result arrived.");
    } catch (e) {
      setError(
        e instanceof Error && e.name === "AbortError"
          ? "Migration cancelled. Check Otari usage before starting another AI job."
          : e instanceof TypeError
            ? `The connection to BridgeFox was interrupted. Keep this page open and check that the app server is running.${mode === "otari" ? " Otari may have processed a request; check gateway usage before starting another AI job." : " You can retry local rules once the connection is restored."}`
          : e instanceof Error
            ? e.message
            : "Migration failed.",
      );
    } finally {
      setBusy(null);
      abort.current = null;
    }
  }
  async function exportPackage() {
    if (!project || !result || busy || (blockers && !project.source)) return;
    setBusy("export");
    setError("");
    try {
      const response = await fetch("/api/export", {
        method: "POST",
        headers: headers(true),
        body: JSON.stringify({ ...(projectId ? { projectId } : { original: project }), patches: result.patches, format: project.source ? "source" : "addon" }),
      });
      if (!response.ok) {
        await responseJson(response);
        return;
      }
      if (response.headers.get("content-type")?.includes("application/json")) {
        const { downloadUrl, name } = await responseJson(response);
        const stored = await fetch(downloadUrl);
        if (!stored.ok) throw new Error("The exported package could not be downloaded");
        download(await stored.blob(), name);
        return;
      }
      const filename =
        /filename="([^"]+)"/.exec(
          response.headers.get("content-disposition") ?? "",
        )?.[1] ?? "extension-firefox.zip";
      download(await response.blob(), filename);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setBusy(null);
    }
  }
  function downloadReport() {
    if (report)
      download(
        new Blob(
          [JSON.stringify(result ?? { report, runtimeTested: false }, null, 2)],
          { type: "application/json" },
        ),
        "bridgefox-report.json",
      );
  }
  function go(next: View) {
    if (busy) return;
    if (next !== "overview" && !project) {
      setView("overview");
      importer.current?.scrollIntoView({
        behavior: animate ? "smooth" : "instant",
      });
      return;
    }
    setError("");
    setView(next);
  }
  function newMigration() {
    if (busy) return;
    setView("overview");
    setError("");
    setTimeout(
      () =>
        importer.current?.scrollIntoView({
          behavior: animate ? "smooth" : "instant",
        }),
      0,
    );
  }
  const sourceFile = project?.files.find((f) => f.path === selectedFile);
  const outputFile =
    result?.project.files.find((f) => f.path === selectedFile) ?? sourceFile;
  const filePatches =
    result?.patches.filter((p) => p.path === selectedFile) ?? [];
  const visibleActivities = activities.reduce<Activity[]>(
    (all, activity) =>
      activity.label === "AI review note"
        ? [...all, activity]
        : [...all.filter((a) => a.label !== activity.label), activity],
    [],
  );
  const filteredHistory = history.filter((h) =>
    h.name.toLowerCase().includes(query.toLowerCase()),
  );

  const [palette, setPalette] = useState<Palette>("daylight");
  const [motionEnabled, setMotionEnabled] = useState(true);
  const [appearanceReady, setAppearanceReady] = useState(false);
  const [codeMode, setCodeMode] = useState<"split" | "unified">("split");
  const [focusEditor, setFocusEditor] = useState(false);
  const [fileQuery, setFileQuery] = useState("");
  const [filePage, setFilePage] = useState(0);
  const matchingFiles = project?.files.filter(f => f.path.toLowerCase().includes(fileQuery.toLowerCase())) ?? [];
  const pageSize = 100;
  const currentFilePage = Math.min(filePage, Math.max(0, Math.ceil(matchingFiles.length / pageSize) - 1));
  const visibleFiles = matchingFiles.slice(currentFilePage * pageSize, (currentFilePage + 1) * pageSize);
  const reducedMotion = useReducedMotion();
  // The first client render must match SSR even when the device prefers reduced motion.
  const animate = appearanceReady && motionEnabled && !reducedMotion;
  useEffect(() => {
    try {
      const saved = localStorage.getItem("bridgefox-palette");
      if (palettes.some((p) => p.id === saved)) setPalette(saved as Palette);
      setMotionEnabled(localStorage.getItem("bridgefox-motion") !== "off");
    } catch {
      /* Appearance persistence is optional. */
    }
    setAppearanceReady(true);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = palette;
    document.documentElement.dataset.motion = animate ? "on" : "off";
    if (appearanceReady)
      try {
        localStorage.setItem("bridgefox-palette", palette);
        localStorage.setItem("bridgefox-motion", motionEnabled ? "on" : "off");
      } catch {
        /* Optional local preferences. */
      }
  }, [palette, motionEnabled, appearanceReady, animate]);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [view]);
  const cyclePalette = () =>
    setPalette(
      palettes[
        (palettes.findIndex((p) => p.id === palette) + 1) % palettes.length
      ].id,
    );
  const navItems = [
    { key: "overview" as View, label: "Overview", icon: LayoutDashboard },
    { key: "workspace" as View, label: "Migration studio", icon: Code2 },
    { key: "report" as View, label: "Compatibility report", icon: ShieldCheck },
    { key: "export" as View, label: "Export & install", icon: ArrowDownToLine },
  ];

  return (
    <MotionConfig
      reducedMotion="user"
      transition={{ duration: animate ? 0.25 : 0, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <div className={`app-shell ${palette}`}>
        <aside className="sidebar">
          <a href="/" className="brand" aria-label="BridgeFox home">
            <span className="brand-mark">
              <FoxMark />
            </span>
            <span>
              bridgefox<span className="brand-dot">.</span>
            </span>
          </a>
          <div className="workspace-label">
            <span className="workspace-avatar">
              B<span />
            </span>
            <div>
              Personal workspace<small>Your little corner of the web</small>
            </div>
          </div>
          <p className="nav-label">YOUR WORKSPACE</p>
          <nav aria-label="Main navigation">
            {navItems.map((item) => (
              <button
                key={item.key}
                className={`nav-item ${view === item.key ? "active" : ""}`}
                aria-label={item.label}
                onClick={() => go(item.key)}
                aria-current={view === item.key ? "page" : undefined}
              >
                {view === item.key && (
                  <motion.span
                    className="nav-active-surface"
                    layoutId="navigation-active"
                    transition={
                      animate
                        ? { type: "spring", stiffness: 350, damping: 30 }
                        : { duration: 0 }
                    }
                  />
                )}
                <item.icon size={19} />
                <span>{item.label}</span>
                {item.key === "report" && report && (
                  <span className="nav-count">{report.findings.length}</span>
                )}
                {view === item.key && (
                  <ArrowUpRight size={15} className="nav-arrow" />
                )}
              </button>
            ))}
          </nav>
          <div className="sidebar-divider" />
          <p className="nav-label resource-label">A LITTLE GUIDANCE</p>
          <button className="nav-item" onClick={() => setModal("guide")}>
            <BookOpen size={18} />
            <span>Getting started</span>
            <ArrowUpRight size={14} className="nav-end" />
          </button>
          <a
            className="nav-item"
            href="https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Chrome_incompatibilities"
            target="_blank"
            rel="noreferrer"
          >
            <Globe size={18} />
            <span>Firefox API docs</span>
            <ArrowUpRight size={14} className="nav-end" />
          </a>
          <div className="sidebar-bottom">
            <div className="gateway-card">
              <div className="gateway-card-title">
                <span
                  className={`status-dot ${config.configured ? "green" : "amber"}`}
                />
                <span>BUILT WITH OTARI</span>
                <Zap size={14} />
              </div>
              <p>
                Open models.
                <br />
                An open road.
              </p>
              <button onClick={() => setModal("settings")}>
                {config.configured
                  ? "View gateway setup"
                  : "Connect your gateway"}
                <ArrowUpRight size={15} />
              </button>
              <span className="gateway-decoration" aria-hidden="true">
                ✳
              </span>
            </div>
            <button
              className="nav-item settings"
              onClick={() => setModal("settings")}
            >
              <Settings2 size={18} />
              <span>Workspace settings</span>
            </button>
            <div className="sidebar-footer">
              <span className="footer-dot" />
              <span>Made for a more open web.</span>
              <span>↗</span>
            </div>
          </div>
        </aside>
        <main className="main">
          <header className="topbar">
            <div className="breadcrumbs">
              <span className="workspace-crumb">
                <FolderOpen size={14} />
                Workspace
              </span>
              <span className="crumb-separator">/</span>
              <strong>{headings[view]}</strong>
            </div>
            <div className="topbar-right">
              <div className="search-box">
                <Search size={16} />
                <input
                  ref={searchInput}
                  aria-label="Search migration history"
                  placeholder="Find a migration..."
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setView("overview");
                  }}
                />
                <kbd>
                  <Command size={11} /> K
                </kbd>
              </div>
              <div className="topbar-tools">
                <button
                  className="icon-button appearance-button"
                  aria-label="Change palette"
                  title={`Palette: ${palettes.find((p) => p.id === palette)?.name}. Click to change.`}
                  onClick={cyclePalette}
                >
                  {palette === "dusk" ? <Moon size={18} /> : <Sun size={18} />}
                </button>
                <button
                  className="icon-button"
                  aria-label={
                    motionEnabled ? "Pause animations" : "Enable animations"
                  }
                  title={
                    appearanceReady && reducedMotion
                      ? "Your device prefers reduced motion"
                      : motionEnabled
                        ? "Pause decorative motion"
                        : "Enable motion"
                  }
                  onClick={() => setMotionEnabled(!motionEnabled)}
                >
                  {motionEnabled ? <Pause size={16} /> : <Play size={16} />}
                </button>
                <button
                  className="icon-button"
                  aria-label="Open settings"
                  onClick={() => setModal("settings")}
                >
                  <Settings2 size={18} />
                </button>
              </div>
              <span className="top-avatar">B</span>
            </div>
          </header>
          <div
            className={`main-content ${view === "workspace" ? "studio-content" : ""}`}
          >
            <AnimatePresence>
              {error && (
                <motion.div
                  className="error-banner"
                  role="alert"
                  initial={animate ? { opacity: 0, y: -8 } : false}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  <CircleAlert size={19} />
                  <span>{error}</span>
                  <button
                    aria-label="Dismiss error"
                    onClick={() => setError("")}
                  >
                    <X size={17} />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={view}
                className="view-page"
                initial={animate ? { opacity: 0, y: 10 } : false}
                animate={{ opacity: 1, y: 0 }}
                exit={animate ? { opacity: 0, y: -6 } : { opacity: 0 }}
                transition={{ duration: animate ? 0.2 : 0 }}
              >
                {view === "overview" ? (
                  <>
                    <div className="page-intro">
                      <div>
                        <span className="eyebrow">
                          YOUR COMPATIBILITY STUDIO{" "}
                          <span className="eyebrow-line" />
                        </span>
                        <h2>Good ideas travel.</h2>
                        <p>
                          Let’s give your extensions a little more room to roam.
                        </p>
                      </div>
                      <ActionButton
                        className="secondary"
                        motionEnabled={animate}
                        onClick={newMigration}
                        disabled={!!busy}
                      >
                        <Plus size={17} />
                        Import extension
                      </ActionButton>
                    </div>
                    <section className="hero">
                      <div className="hero-copy">
                        <span className="hero-tag">
                          <span />A BRIDGE TO THE BROWSER YOU CHOOSE
                        </span>
                        <h1>
                          Chrome extensions.
                          <br />
                          <span>Firefox freedom.</span>
                          <svg
                            className="hero-underline"
                            viewBox="0 0 350 14"
                            aria-hidden="true"
                          >
                            <motion.path
                              d="M3 9Q120 1 346 7"
                              stroke="currentColor"
                              strokeWidth="3"
                              fill="none"
                              strokeLinecap="round"
                              initial={animate ? { pathLength: 0 } : false}
                              animate={{ pathLength: 1 }}
                              transition={{
                                duration: animate ? 0.9 : 0,
                                delay: animate ? 0.45 : 0,
                              }}
                            />
                          </svg>
                        </h1>
                        <p>
                          Bring the extensions you love.
                          <br />
                          We’ll help them feel at home in Firefox.
                        </p>
                        <div className="hero-actions">
                          <ActionButton
                            className="primary"
                            motionEnabled={animate}
                            onClick={newMigration}
                            disabled={!!busy}
                          >
                            New migration
                            <ArrowUpRight size={18} />
                          </ActionButton>
                          <button
                            className="text-button"
                            onClick={loadDemo}
                            disabled={!!busy}
                          >
                            Try an example
                            <span className="round-arrow">
                              <ArrowRight size={15} />
                            </span>
                          </button>
                        </div>
                        <span className="hero-footnote">
                          Thoughtful changes. Every step in plain sight.
                        </span>
                      </div>
                      <BrowserHandoff key={appearanceReady ? "ready" : "initial"} enabled={animate} />
                      <div className="hero-features">
                        <span>
                          <FileCode2 size={14} />
                          Manifest V2 & V3
                        </span>
                        <span>
                          <GitBranch size={14} />
                          Changes you can review
                        </span>
                        <span>
                          <ShieldCheck size={14} />
                          Permissions preserved
                        </span>
                        <span className="hero-feature-last">
                          YOUR EXTENSIONS. YOUR CHOICE.
                          <ArrowUpRight size={13} />
                        </span>
                      </div>
                    </section>
                    <section ref={importer} className="import-section">
                      <div className="section-heading">
                        <div>
                          <span className="eyebrow">
                            01 / MAKE THE FIRST MOVE
                          </span>
                          <h2>Where would you like to start?</h2>
                        </div>
                        <span className="small-pill">
                          <LockKeyhole size={13} />
                          No source in browser history
                        </span>
                      </div>
                      <div className="import-grid">
                        <Reveal className="upload-panel" enabled={animate}>
                          <div
                            className="panel-tabs import-tabs"
                            role="tablist"
                            aria-label="Import method"
                          >
                            {(["zip", "github"] as const).map((tab) => (
                              <button
                                role="tab"
                                aria-selected={importTab === tab}
                                key={tab}
                                onClick={() => setImportTab(tab)}
                              >
                                {importTab === tab && (
                                  <motion.span
                                    className="tab-surface"
                                    layoutId="import-tab"
                                    transition={{ duration: animate ? 0.2 : 0 }}
                                  />
                                )}
                                <span>
                                  {tab === "zip" ? (
                                    <Upload size={16} />
                                  ) : (
                                    <GitBranch size={16} />
                                  )}
                                </span>
                                <span>
                                  {tab === "zip"
                                    ? "Upload ZIP"
                                    : "GitHub repository"}
                                </span>
                              </button>
                            ))}
                          </div>
                          <AnimatePresence mode="wait" initial={false}>
                            {importTab === "zip" ? (
                              <motion.div
                                key="zip"
                                className={`dropzone ${dragging ? "dragging" : ""}`}
                                initial={animate ? { opacity: 0 } : false}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: animate ? 0.15 : 0 }}
                                onDragOver={(e) => {
                                  e.preventDefault();
                                  setDragging(true);
                                }}
                                onDragLeave={() => setDragging(false)}
                                onDrop={(e) => {
                                  e.preventDefault();
                                  setDragging(false);
                                  void upload(e.dataTransfer.files[0]);
                                }}
                              >
                                <motion.div
                                  className="upload-symbol"
                                  animate={
                                    animate && dragging
                                      ? { rotate: -6, y: -4, scale: 1.08 }
                                      : { rotate: -4, y: 0, scale: 1 }
                                  }
                                >
                                  <FolderOpen size={38} />
                                  <span>
                                    <Plus size={15} />
                                  </span>
                                </motion.div>
                                <h3>
                                  {busy === "import"
                                    ? "Getting to know your extension…"
                                    : dragging
                                      ? "This is the place. Drop it in."
                                      : "Drop your extension here"}
                                </h3>
                                <p>
                                  Your extension source, zipped up and ready to
                                  go.
                                </p>
                                <ActionButton
                                  className="secondary"
                                  motionEnabled={animate}
                                  onClick={() => fileInput.current?.click()}
                                  disabled={!!busy}
                                >
                                  {busy === "import" ? (
                                    <LoaderCircle className="spin" size={16} />
                                  ) : (
                                    <Upload size={16} />
                                  )}
                                  Browse files
                                </ActionButton>
                                <span className="upload-limit">
                                  .ZIP FILES · UP TO {UPLOAD_SIZE_LABEL}
                                </span>
                              </motion.div>
                            ) : (
                              <motion.form
                                key="github"
                                className="github-form"
                                onSubmit={importGithub}
                                initial={animate ? { opacity: 0 } : false}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: animate ? 0.15 : 0 }}
                              >
                                <label>
                                  Public repository URL
                                  <input
                                    type="url"
                                    required
                                    placeholder="https://github.com/you/your-extension"
                                    value={githubUrl}
                                    onChange={(e) =>
                                      setGithubUrl(e.target.value)
                                    }
                                  />
                                </label>
                                <div className="github-branch-row">
                                  <label>
                                    Branch
                                    <input
                                      required
                                      value={branch}
                                      onChange={(e) =>
                                        setBranch(e.target.value)
                                      }
                                    />
                                  </label>
                                  <ActionButton
                                    className="primary"
                                    motionEnabled={animate}
                                    disabled={!!busy}
                                  >
                                    {busy === "import" ? (
                                      <LoaderCircle
                                        size={16}
                                        className="spin"
                                      />
                                    ) : (
                                      <GitBranch size={16} />
                                    )}
                                    Import repository
                                  </ActionButton>
                                </div>
                                <p>
                                  A built extension or a source repository with browser manifest templates.
                                </p>
                              </motion.form>
                            )}
                          </AnimatePresence>
                          <input
                            ref={fileInput}
                            className="visually-hidden"
                            type="file"
                            accept=".zip,application/zip"
                            aria-label="Choose extension source ZIP"
                            onChange={(e) => void upload(e.target.files?.[0])}
                          />
                          <div className="upload-footer">
                            <ShieldCheck size={14} />
                            <span>Source inspected without running it.</span>
                            <span className="upload-footer-tag">
                              A THOUGHTFUL FIRST STEP
                            </span>
                          </div>
                        </Reveal>
                        <Reveal
                          className="example-panel"
                          enabled={animate}
                          delay={0.06}
                        >
                          <div className="example-header">
                            <span className="eyebrow">
                              JUST LOOKING AROUND?
                            </span>
                            <span className="badge lavender">MIT EXAMPLE</span>
                          </div>
                          <div className="example-content">
                            <div>
                              <h3>Meet Tab Pocket.</h3>
                              <p>
                                A small extension.
                                <br />A perfect first crossing.
                              </p>
                            </div>
                            <div className="example-art">
                              <PackageArt small />
                              <span className="example-float-chip">
                                <Check size={12} />
                                Save the good tabs.
                              </span>
                            </div>
                          </div>
                          <div className="example-description">
                            <span className="example-bullet" />
                            Save a tab. Keep it close. Open it again.
                          </div>
                          <ActionButton
                            className="ink"
                            motionEnabled={animate}
                            onClick={loadDemo}
                            disabled={!!busy}
                          >
                            Load Tab Pocket
                            <ArrowUpRight size={17} />
                          </ActionButton>
                        </Reveal>
                      </div>
                    </section>
                    <section className="workspace-stats">
                      <div className="section-heading compact">
                        <h2>A little progress, at a glance.</h2>
                        <span className="muted-label">
                          SAVED IN THIS BROWSER
                        </span>
                      </div>
                      <div
                        className="stats-grid"
                        aria-label="Workspace statistics"
                      >
                        <Reveal className="stat-card" enabled={animate}>
                          <span className="stat-icon coral">
                            <GitBranch size={20} />
                          </span>
                          <div>
                            <span className="stat-title">Saved migrations</span>
                            <div className="stat-value">
                              {history.length}
                              <span>Every crossing starts somewhere.</span>
                            </div>
                          </div>
                          <span className="stat-corner">01</span>
                        </Reveal>
                        <Reveal
                          className="stat-card"
                          enabled={animate}
                          delay={0.04}
                        >
                          <span className="stat-icon mint">
                            <CheckCheck size={21} />
                          </span>
                          <div>
                            <span className="stat-title">
                              Export candidates
                            </span>
                            <div className="stat-value">
                              {
                                history.filter((h) => h.status === "candidate")
                                  .length
                              }
                              <span>Next stop: a real Firefox test.</span>
                            </div>
                          </div>
                          <span className="stat-corner">02</span>
                        </Reveal>
                        <Reveal
                          className="stat-card"
                          enabled={animate}
                          delay={0.08}
                        >
                          <span className="stat-icon lavender">
                            <ShieldCheck size={21} />
                          </span>
                          <div>
                            <span className="stat-title">
                              Permission policy
                            </span>
                            <div className="stat-value stat-word">
                              Preserved<span>No silent changes to access.</span>
                            </div>
                          </div>
                          <span className="stat-corner">03</span>
                        </Reveal>
                      </div>
                    </section>
                    <section className="recent-section">
                      <div className="section-heading">
                        <div>
                          <span className="eyebrow">
                            02 / YOUR JOURNEY SO FAR
                          </span>
                          <h2>
                            Recent migrations
                            <span className="count-badge">
                              {history.length}
                            </span>
                          </h2>
                        </div>
                        {history.length > 0 && (
                          <button
                            className="text-button muted"
                            onClick={() => {
                              setHistory([]);
                              try {
                                localStorage.removeItem("bridgefox-history");
                              } catch {
                                /* optional history */
                              }
                            }}
                          >
                            Clear local history
                            <X size={12} />
                          </button>
                        )}
                      </div>
                      <div className="history-table">
                        <div className="table-heading">
                          <span>EXTENSION</span>
                          <span>STATUS</span>
                          <span>CHANGES</span>
                          <span>LAST MIGRATED</span>
                          <span />
                        </div>
                        {filteredHistory.length ? (
                          filteredHistory.map((h, i) => (
                            <motion.button
                              className="history-row"
                              key={h.id}
                              initial={animate ? { opacity: 0, y: 8 } : false}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{
                                duration: animate ? 0.25 : 0,
                                delay: animate ? i * 0.03 : 0,
                              }}
                              onClick={() => {
                                setHistoryItem(h);
                                setModal("history");
                              }}
                            >
                              <span className="history-name">
                                <span className="extension-icon">
                                  <FileCode2 size={21} />
                                </span>
                                <span>
                                  {h.name}
                                  <small>
                                    Manifest V{h.report.manifestVersion} ·{" "}
                                    {h.report.fileCount} files
                                  </small>
                                </span>
                              </span>
                              <span>
                                <span
                                  className={`badge ${h.status === "candidate" ? "success" : "warning"}`}
                                >
                                  <span />
                                  {h.status === "candidate"
                                    ? "Candidate"
                                    : "Needs review"}
                                </span>
                              </span>
                              <span className="mono">
                                {h.patches} {h.patches === 1 ? "file" : "files"}
                              </span>
                              <span className="history-date">
                                {new Date(h.date).toLocaleDateString(
                                  undefined,
                                  { month: "short", day: "numeric" },
                                )}
                              </span>
                              <ArrowUpRight size={17} />
                            </motion.button>
                          ))
                        ) : (
                          <div className="empty-history">
                            <span className="empty-history-art">
                              <GitBranch size={34} />
                              <span>↗</span>
                            </span>
                            <div>
                              <h3>
                                {query
                                  ? "No matching migrations"
                                  : "A fresh page. Plenty of possibility."}
                              </h3>
                              <p>
                                {query
                                  ? "Try another extension name."
                                  : "Your migrations will land here. Let’s make the first one."}
                              </p>
                            </div>
                            {!query && (
                              <button
                                className="text-button"
                                onClick={loadDemo}
                                disabled={!!busy}
                              >
                                Start with Tab Pocket
                                <ArrowRight size={16} />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </section>
                  </>
                ) : project && report ? (
                  <>
                    <div className="project-heading">
                      <div>
                        <button
                          className="back-button"
                          onClick={() => go("overview")}
                          disabled={!!busy}
                        >
                          <ArrowLeft size={15} />
                          All migrations
                        </button>
                        <div className="project-title">
                          <span className="project-icon">
                            <FolderOpen size={27} />
                          </span>
                          <h1>{report.name}</h1>
                          <span className="version-pill">
                            v{report.version}
                          </span>
                        </div>
                        <p>
                          <FileCode2 size={14} />
                          {report.fileCount} files <span>·</span>
                          {size(report.sizeBytes)}
                          <span>·</span>Manifest V{report.manifestVersion}
                        </p>
                      </div>
                      <div className="project-actions">
                        <span
                          className={`badge ${blockers ? "danger" : result ? "success" : "info"}`}
                        >
                          <span />
                          {blockers
                            ? `${blockers} blocker${blockers === 1 ? "" : "s"}`
                            : result
                              ? "Test candidate"
                              : "Ready for analysis"}
                        </span>
                        <ActionButton
                          className="secondary"
                          motionEnabled={animate}
                          onClick={downloadReport}
                        >
                          <Download size={16} />
                          Report
                        </ActionButton>
                      </div>
                    </div>
                    {project.source && (
                      <section className="source-repository-banner">
                        <div>
                          <strong>Source repository · build required</strong>
                          <p>Choose a manifest template for analysis. All repository files are preserved. A Firefox template still needs a build and browser testing.</p>
                        </div>
                        <label>
                          Manifest for analysis
                          <select value={project.source.manifestPath} disabled={!!busy} onChange={e => void selectManifest(e.target.value)}>
                            {project.source.manifestCandidates.map(path => <option key={path} value={path}>{path}</option>)}
                          </select>
                        </label>
                      </section>
                    )}
                    <p className="project-session-note">Keep your original ZIP. This import expires after 30 minutes of inactivity or when the app restarts.</p>
                    <div className="flow-nav" aria-label="Migration stages">
                      {(
                        [
                          [
                            "report",
                            "Compatibility",
                            "Understand the differences",
                          ],
                          [
                            "workspace",
                            "Review changes",
                            "Build a thoughtful bridge",
                          ],
                          ["export", "Export & install", "Take it to Firefox"],
                        ] as const
                      ).map(([key, name, description], i) => (
                        <button
                          key={key}
                          className={view === key ? "current" : ""}
                          onClick={() => go(key)}
                          disabled={!!busy}
                        >
                          {view === key && (
                            <motion.span
                              className="flow-surface"
                              layoutId="flow-current"
                              transition={{ duration: animate ? 0.25 : 0 }}
                            />
                          )}
                          <span className="flow-number">{i + 1}</span>
                          <span className="flow-copy">
                            <strong>{name}</strong>
                            <small>{description}</small>
                          </span>
                          {i < 2 && <ChevronRight size={16} />}
                        </button>
                      ))}
                    </div>
                    {view === "report" && (
                      <>
                        <section className="report-summary">
                          <div className="score-card">
                            <div
                              className="score-ring"
                              style={
                                {
                                  "--score": `${report.score}%`,
                                } as React.CSSProperties
                              }
                            >
                              <span>
                                <b>{report.score}</b>
                                <small>out of 100</small>
                              </span>
                            </div>
                            <div>
                              <span className="eyebrow">
                                YOUR COMPATIBILITY SNAPSHOT
                              </span>
                              <h2>
                                {blockers
                                  ? "A few things need a new route."
                                  : report.findings.length
                                    ? "A little closer to Firefox."
                                    : "Ready for a real browser test."}
                              </h2>
                              <p>
                                This score reflects our static checks.
                                <br />
                                The final proof happens in Firefox.
                              </p>
                            </div>
                          </div>
                          <div className="report-counts">
                            <span>
                              <b className="teal-text">
                                {
                                  report.apis.filter(
                                    (a) => a.support === "supported",
                                  ).length
                                }
                              </b>
                              <span>
                                Supported API members
                                <Check size={12} />
                              </span>
                            </span>
                            <span>
                              <b className="amber-text">
                                {
                                  report.findings.filter(
                                    (f) => f.severity !== "blocked",
                                  ).length
                                }
                              </b>
                              <span>
                                Changes & review notes
                                <GitBranch size={12} />
                              </span>
                            </span>
                            <span>
                              <b className="red-text">{blockers}</b>
                              <span>
                                Blocking findings
                                <CircleAlert size={12} />
                              </span>
                            </span>
                          </div>
                        </section>
                        <section className="report-panel">
                          <div className="report-panel-header">
                            <h2>Let’s look a little closer.</h2>
                            <span className="muted-label">
                              MOZILLA COMPATIBILITY DATA
                            </span>
                          </div>
                          <div
                            className="panel-tabs report-tabs"
                            role="tablist"
                            aria-label="Compatibility details"
                          >
                            {(["findings", "apis", "permissions"] as const).map(
                              (tab) => (
                                <button
                                  role="tab"
                                  aria-selected={reportTab === tab}
                                  key={tab}
                                  onClick={() => setReportTab(tab)}
                                >
                                  {reportTab === tab && (
                                    <motion.span
                                      className="tab-surface"
                                      layoutId="report-tab"
                                      transition={{
                                        duration: animate ? 0.2 : 0,
                                      }}
                                    />
                                  )}
                                  <span>
                                    {tab === "findings" ? (
                                      <CircleAlert size={16} />
                                    ) : tab === "apis" ? (
                                      <Code2 size={16} />
                                    ) : (
                                      <ShieldCheck size={16} />
                                    )}
                                  </span>
                                  <span>
                                    {
                                      {
                                        findings: "Findings",
                                        apis: "API compatibility",
                                        permissions: "Permissions",
                                      }[tab]
                                    }
                                  </span>
                                  <span className="count-badge">
                                    {tab === "findings"
                                      ? report.findings.length
                                      : tab === "apis"
                                        ? report.apis.length
                                        : report.permissions.length}
                                  </span>
                                </button>
                              ),
                            )}
                          </div>
                          <AnimatePresence mode="wait" initial={false}>
                            <motion.div
                              key={reportTab}
                              initial={animate ? { opacity: 0, y: 5 } : false}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0 }}
                              transition={{ duration: animate ? 0.15 : 0 }}
                            >
                              {reportTab === "findings" ? (
                                <div className="findings">
                                  {report.findings.length ? (
                                    report.findings.map((f, i) => (
                                      <Reveal
                                        className={`finding ${f.severity}`}
                                        key={f.id}
                                        enabled={animate}
                                        delay={i * 0.035}
                                      >
                                        <span
                                          className={`finding-icon ${f.severity}`}
                                        >
                                          {f.severity === "change" ? (
                                            <GitBranch size={20} />
                                          ) : (
                                            <CircleAlert size={20} />
                                          )}
                                        </span>
                                        <div>
                                          <div className="finding-title">
                                            <h3>{f.title}</h3>
                                            <span
                                              className={`badge ${f.severity === "blocked" ? "danger" : f.severity === "change" ? "info" : "warning"}`}
                                            >
                                              {f.automatic
                                                ? "Automatic proposal"
                                                : f.severity === "blocked"
                                                  ? "Manual redesign"
                                                  : "Review"}
                                            </span>
                                          </div>
                                          <p>{f.detail}</p>
                                          <div className="finding-meta">
                                            <span className="mono">
                                              <FileCode2 size={12} />
                                              {f.file}
                                              {f.line ? `:${f.line}` : ""}
                                            </span>
                                            {f.source && (
                                              <a
                                                href={f.source}
                                                target="_blank"
                                                rel="noreferrer"
                                              >
                                                Read the Mozilla docs
                                                <ArrowUpRight size={13} />
                                              </a>
                                            )}
                                          </div>
                                        </div>
                                      </Reveal>
                                    ))
                                  ) : (
                                    <div className="passed-empty">
                                      <span>
                                        <CheckCheck size={31} />
                                      </span>
                                      <h3>
                                        A clean sheet in the checked rules.
                                      </h3>
                                      <p>
                                        Take it to Firefox and see how it feels.
                                      </p>
                                    </div>
                                  )}
                                </div>
                              ) : reportTab === "apis" ? (
                                <div className="api-table">
                                  <div className="api-heading">
                                    <span>API MEMBER</span>
                                    <span>WHERE IT LIVES</span>
                                    <span>FIREFOX DATA</span>
                                  </div>
                                  {report.apis.length ? (
                                    report.apis.map((api, i) => (
                                      <div
                                        className="api-row"
                                        key={`${api.file}-${api.api}-${i}`}
                                      >
                                        <code>{api.api}</code>
                                        <span className="mono">
                                          {api.file}:{api.line}
                                        </span>
                                        <span
                                          className={`badge ${api.support === "supported" ? "success" : api.support === "unsupported" ? "danger" : "warning"}`}
                                        >
                                          <span />
                                          {api.support}
                                        </span>
                                      </div>
                                    ))
                                  ) : (
                                    <p className="panel-empty">
                                      No direct chrome.* or browser.* API
                                      members found. Aliases and dynamic access
                                      need a closer look.
                                    </p>
                                  )}
                                  <p className="panel-footnote">
                                    <BookOpen size={14} />
                                    Mozilla’s data is our starting point.
                                    Arguments, browser versions, and real
                                    behavior still need review.
                                  </p>
                                </div>
                              ) : (
                                <div className="permissions-panel">
                                  <div className="permission-note">
                                    <ShieldCheck size={24} />
                                    <div>
                                      <h3>Same access. A different browser.</h3>
                                      <p>
                                        Required and optional permissions stay
                                        unchanged through migration.
                                      </p>
                                    </div>
                                  </div>
                                  <div className="permission-tags">
                                    {report.permissions.length ? (
                                      report.permissions.map((p) => (
                                        <code key={p}>
                                          <LockKeyhole size={12} />
                                          {p}
                                        </code>
                                      ))
                                    ) : (
                                      <span>No permissions declared.</span>
                                    )}
                                  </div>
                                  <small>
                                    Confirm every requested permission serves a
                                    purpose.
                                  </small>
                                </div>
                              )}
                            </motion.div>
                          </AnimatePresence>
                        </section>
                        <section className="migration-bar">
                          <div className="migration-bar-copy">
                            <span className="migration-symbol">
                              <Sparkles size={23} />
                            </span>
                            <div>
                              <h3>Choose your path across.</h3>
                              <p>
                                Either way, you’ll review the changes before
                                exporting.
                              </p>
                            </div>
                          </div>
                          <div className="migration-controls">
                            <EnginePicker
                              mode={mode}
                              onChange={setMode}
                              configured={config.configured}
                            />
                            <ActionButton
                              className="primary"
                              motionEnabled={animate}
                              onClick={runMigration}
                              disabled={!!busy}
                            >
                              Generate migration
                              <ArrowUpRight size={17} />
                            </ActionButton>
                          </div>
                        </section>
                      </>
                    )}
                    {view === "workspace" && (
                      <>
                        <div className="workspace-toolbar">
                          <div className="workspace-run-state">
                            <span
                              className={`status-dot ${busy === "migrate" ? "blue" : result ? "green" : "amber"}`}
                            />
                            <strong>
                              {busy === "migrate"
                                ? "Building the bridge…"
                                : result
                                  ? "Proposals ready for review"
                                  : "Your source, ready for a closer look."}
                            </strong>
                            {result && (
                              <span className="badge neutral">
                                {result.patches.length} file proposal
                                {result.patches.length === 1 ? "" : "s"}
                              </span>
                            )}
                          </div>
                          <div>
                            {busy === "migrate" ? (
                              <ActionButton
                                className="secondary compact"
                                motionEnabled={animate}
                                onClick={() => abort.current?.abort()}
                              >
                                <X size={15} />
                                Cancel
                              </ActionButton>
                            ) : (
                              <>
                                <EnginePicker
                                  mode={mode}
                                  onChange={setMode}
                                  configured={config.configured}
                                  compact
                                />
                                <ActionButton
                                  className="primary compact"
                                  motionEnabled={animate}
                                  onClick={runMigration}
                                  disabled={!!busy}
                                >
                                  <Sparkles size={15} />
                                  {result ? "Run again" : "Generate changes"}
                                </ActionButton>
                              </>
                            )}
                          </div>
                        </div>
                        <div
                          className={`editor-layout ${focusEditor ? "editor-focused" : ""}`}
                        >
                          <aside className="file-tree">
                            <div className="file-tree-heading">
                              <span>SOURCE FILES</span>
                              <span>{project.files.length}</span>
                            </div>
                            <div className="file-search">
                              <Search size={13} />
                              <input
                                aria-label="Search source files"
                                value={fileQuery}
                                onChange={(e) => { setFileQuery(e.target.value); setFilePage(0); }}
                                placeholder="Find a file..."
                              />
                            </div>
                            {visibleFiles.map((file) => (
                                <button
                                  key={file.path}
                                  onClick={() => setSelectedFile(file.path)}
                                  className={
                                    selectedFile === file.path ? "selected" : ""
                                  }
                                >
                                  {file.path.endsWith(".json") ? (
                                    <FileJson2 size={15} />
                                  ) : (
                                    <FileCode2 size={15} />
                                  )}
                                  <span>{file.path}</span>
                                  {result?.patches.some(
                                    (p) => p.path === file.path,
                                  ) && <span className="changed-dot" />}
                                </button>
                              ))}
                            {!matchingFiles.length && (
                              <p className="file-search-empty">
                                No files found.
                              </p>
                            )}
                            {matchingFiles.length > pageSize && (
                              <div className="file-pagination">
                                <small aria-live="polite">{currentFilePage * pageSize + 1}–{Math.min((currentFilePage + 1) * pageSize, matchingFiles.length)} of {matchingFiles.length}</small>
                                <button aria-label="Previous source files" disabled={currentFilePage === 0} onClick={() => setFilePage(currentFilePage - 1)}>Previous</button>
                                <button aria-label="Next source files" disabled={(currentFilePage + 1) * pageSize >= matchingFiles.length} onClick={() => setFilePage(currentFilePage + 1)}>Next</button>
                              </div>
                            )}
                            <div className="file-tree-note">
                              <ShieldCheck size={14} />
                              Original assets stay intact.
                            </div>
                          </aside>
                          <div className="code-pane">
                            <div className="code-header">
                              <span className="code-filename">
                                <FileCode2 size={15} />
                                {selectedFile}
                              </span>
                              <span
                                className={`badge ${filePatches.length ? "info" : "neutral"}`}
                              >
                                {filePatches.length ? "Changed" : "Unchanged"}
                              </span>
                              <div
                                className="editor-view-toggle"
                                role="group"
                                aria-label="Source view"
                              >
                                <button
                                  aria-pressed={codeMode === "split"}
                                  onClick={() => setCodeMode("split")}
                                >
                                  Split
                                </button>
                                <button
                                  aria-pressed={codeMode === "unified"}
                                  onClick={() => setCodeMode("unified")}
                                >
                                  Unified
                                </button>
                              </div>
                              <button
                                className="icon-button"
                                aria-label={
                                  focusEditor
                                    ? "Exit editor focus"
                                    : "Focus editor"
                                }
                                onClick={() => setFocusEditor(!focusEditor)}
                              >
                                {focusEditor ? (
                                  <Minimize2 size={16} />
                                ) : (
                                  <Maximize2 size={16} />
                                )}
                              </button>
                            </div>
                            {codeMode === "split" ? (
                              <div className="code-columns">
                                <div>
                                  <div className="code-side-heading">
                                    <ChromeMark size={15} />
                                    <strong>Chrome source</strong>
                                    <span>ORIGINAL</span>
                                  </div>
                                  {sourceFile?.encoding === "utf8" ? (
                                    <CodeView
                                      code={sourceFile.content}
                                      path={selectedFile}
                                      label="Original Chrome source"
                                      dark={palette === "dusk"}
                                      changed={ChangedLines(
                                        sourceFile.content,
                                        outputFile?.content ??
                                          sourceFile.content,
                                        "before",
                                      )}
                                      side="before"
                                    />
                                  ) : (
                                    <pre aria-label="Original Chrome source">
                                      Binary asset preserved: {sourceFile?.path}
                                    </pre>
                                  )}
                                </div>
                                <div>
                                  <div className="code-side-heading">
                                    <FoxMark small />
                                    <strong>Firefox proposal</strong>
                                    <span>FOR REVIEW</span>
                                  </div>
                                  {outputFile?.encoding === "utf8" ? (
                                    <CodeView
                                      code={outputFile.content}
                                      path={selectedFile}
                                      label="Firefox source changes"
                                      dark={palette === "dusk"}
                                      changed={ChangedLines(
                                        sourceFile?.content ??
                                          outputFile.content,
                                        outputFile.content,
                                        "after",
                                      )}
                                      side="after"
                                    />
                                  ) : (
                                    <pre aria-label="Firefox source changes">
                                      Binary asset preserved without changes.
                                    </pre>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <div className="unified-code">
                                <div className="code-side-heading">
                                  <GitBranch size={15} />
                                  <strong>Every change, in one view.</strong>
                                  <span>− ORIGINAL / + PROPOSAL</span>
                                </div>
                                {sourceFile?.encoding === "utf8" &&
                                outputFile?.encoding === "utf8" ? (
                                  <UnifiedDiff
                                    before={sourceFile.content}
                                    after={outputFile.content}
                                    path={selectedFile}
                                  />
                                ) : (
                                  <pre>
                                    Binary asset preserved without changes.
                                  </pre>
                                )}
                              </div>
                            )}
                            {filePatches.length > 0 && (
                              <div className="patch-explanation">
                                <span className="explanation-icon">
                                  <Sparkles size={18} />
                                </span>
                                <div>
                                  <h3>A little context for this change.</h3>
                                  {filePatches.map((patch, i) => (
                                    <p key={i}>
                                      <span className="badge info">
                                        {patch.origin === "otari"
                                          ? "Otari proposal"
                                          : "Local rule"}
                                      </span>
                                      {patch.reason}
                                    </p>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                          <aside className="activity-panel">
                            <div className="activity-title">
                              <span>
                                <Terminal size={18} />
                              </span>
                              <h3>Behind the scenes</h3>
                              {busy === "migrate" && (
                                <span className="live-pill">LIVE</span>
                              )}
                            </div>
                            <p className="activity-subtitle">
                              The real steps. Every decision in view.
                            </p>
                            {visibleActivities.length ? (
                              <div className="activity-list" aria-live="polite">
                                {visibleActivities.map((activity) => (
                                  <motion.div
                                    layout={animate}
                                    initial={
                                      animate ? { opacity: 0, x: 8 } : false
                                    }
                                    animate={{ opacity: 1, x: 0 }}
                                    className={`activity-item ${activity.status}`}
                                    key={activity.id}
                                  >
                                    <span className="activity-status">
                                      {activity.status === "running" && busy ? (
                                        <LoaderCircle
                                          size={14}
                                          className="spin"
                                        />
                                      ) : activity.status === "complete" ? (
                                        <Check size={14} />
                                      ) : activity.status === "failed" ? (
                                        <X size={14} />
                                      ) : (
                                        <span>–</span>
                                      )}
                                    </span>
                                    <div>
                                      <h4>{activity.label}</h4>
                                      <small>
                                        {activity.origin === "otari"
                                          ? "Otari gateway"
                                          : "Local"}
                                        {activity.model
                                          ? ` · ${activity.model}`
                                          : ""}
                                      </small>
                                      <p>{activity.detail}</p>
                                      {activity.requestId && (
                                        <code title={activity.requestId}>
                                          Request{" "}
                                          {activity.requestId.slice(0, 12)}…
                                        </code>
                                      )}
                                      {activity.fallback && (
                                        <span className="badge warning">
                                          Fallback · {activity.attempts ?? "?"}{" "}
                                          attempts
                                        </span>
                                      )}
                                      {activity.costUsd !== undefined && (
                                        <code>{money(activity.costUsd)}</code>
                                      )}
                                    </div>
                                  </motion.div>
                                ))}
                              </div>
                            ) : (
                              <div className="activity-empty">
                                <Terminal size={29} />
                                <p>
                                  Your migration activity will appear here.
                                  <br />
                                  Real checks. Real proposals.
                                </p>
                              </div>
                            )}
                            <div className="budget-box">
                              <div>
                                <span>AI JOB SPENDING</span>
                                <strong>
                                  {result ? money(result.spentUsd) : "$0.00"}
                                  <small> / {money(config.budgetUsd)}</small>
                                </strong>
                              </div>
                              <div className="budget-track">
                                <motion.span
                                  animate={{
                                    width: `${Math.min(100, ((result?.spentUsd ?? 0) / config.budgetUsd) * 100)}%`,
                                  }}
                                  transition={{ duration: animate ? 0.4 : 0 }}
                                />
                              </div>
                              <p>
                                {result?.costComplete === false
                                  ? "Some cost is unknown. Further paid calls stopped."
                                  : mode === "local"
                                    ? "Local rules make no paid model calls."
                                    : "Gateway key limits also apply. Actual reported cost shown."}
                              </p>
                            </div>
                          </aside>
                        </div>
                        {result && (
                          <div className="workspace-result">
                            <div>
                              <span>
                                <ShieldCheck size={20} />
                              </span>
                              <p>{result.summary}</p>
                            </div>
                            <ActionButton
                              className="primary"
                              motionEnabled={animate}
                              onClick={() => go("export")}
                              disabled={!!busy}
                            >
                              Review & export
                              <ArrowUpRight size={17} />
                            </ActionButton>
                          </div>
                        )}
                      </>
                    )}
                    {view === "export" &&
                      (result ? (
                        <div className="export-grid">
                          <section className="export-card">
                            <div className="export-art-wrap">
                              <PackageArt />
                              <span className="export-art-label">
                                NEXT STOP
                                <br />
                                <strong>FIREFOX.</strong>
                                <ArrowUpRight size={24} />
                              </span>
                            </div>
                            <span className="eyebrow">
                              03 / THE OTHER SIDE OF THE BRIDGE
                            </span>
                            <h2>
                              {project.source ? "Your reviewed source repository." : blockers
                                ? "A little more work before the move."
                                : "Your extension. A new chapter."}
                            </h2>
                            <p>
                              {project.source ? "Download the source and proposals, review the findings, then build the extension with its own toolchain." : blockers
                                ? "Review the required redesigns before packaging. Your report has the next steps."
                                : "Your Firefox candidate is packed and ready. Give it a real browser test before making yourself at home."}
                            </p>
                            <div className="package-preview">
                              <span>
                                <FileCode2 size={24} />
                              </span>
                              <div>
                                <strong>{report.name}{project.source ? "-reviewed-source.zip" : "-firefox.zip"}</strong>
                                <span>
                                  {report.fileCount - (project.source ? 1 : 0)} files · original assets
                                  preserved
                                </span>
                              </div>
                              <span
                                className={`badge ${blockers ? "danger" : "success"}`}
                              >
                                <span />
                                {project.source ? "Build required" : blockers ? "Blocked" : "Candidate"}
                              </span>
                            </div>
                            <ActionButton
                              className="primary full-width"
                              motionEnabled={animate}
                              onClick={exportPackage}
                              disabled={!!busy || (blockers > 0 && !project.source)}
                            >
                              {busy === "export" ? (
                                <LoaderCircle className="spin" size={17} />
                              ) : (
                                <Download size={17} />
                              )}
                              {project.source ? "Download reviewed source ZIP" : "Download Firefox ZIP"}
                              <ArrowDownToLine size={16} />
                            </ActionButton>
                            <button
                              className="text-button report-download"
                              onClick={downloadReport}
                            >
                              <FileText size={15} />
                              Keep a copy of the migration report
                              <ArrowUpRight size={14} />
                            </button>
                            <p className="export-disclaimer">
                              <LockKeyhole size={13} />
                              {project.source ? "Source files only. Build and verify the extension before installing it in Firefox." : "For temporary testing. Not signed or published to Mozilla Add-ons."}
                            </p>
                          </section>
                          <section className="validation-panel">
                            <div className="section-heading">
                              <div>
                                <span className="eyebrow">
                                  A CLEAR VIEW OF WHAT’S READY
                                </span>
                                <h2>Validation results</h2>
                                <p>Know what passed. Know what comes next.</p>
                              </div>
                              <span className="validation-heading-icon">
                                <ShieldCheck size={24} />
                              </span>
                            </div>
                            {result.validations.map((v, i) => (
                              <Reveal
                                className={`validation-item ${v.status}`}
                                key={v.name}
                                enabled={animate}
                                delay={i * 0.035}
                              >
                                <span className="validation-status">
                                  {v.status === "passed" ? (
                                    <Check size={17} />
                                  ) : (
                                    <CircleAlert size={17} />
                                  )}
                                </span>
                                <div>
                                  <h3>
                                    {v.name}
                                    <span
                                      className={`badge ${v.status === "passed" ? "success" : v.status === "failed" ? "danger" : "warning"}`}
                                    >
                                      {v.status}
                                    </span>
                                  </h3>
                                  <p>{v.detail}</p>
                                </div>
                              </Reveal>
                            ))}
                            {report.findings.length > 0 && (
                              <div className="remaining-findings">
                                <h3>Still on your checklist.</h3>
                                {report.findings.map((f) => (
                                  <p key={f.id}>
                                    <CircleAlert size={14} />
                                    {f.title}
                                  </p>
                                ))}
                                <button
                                  className="text-button"
                                  onClick={() => go("report")}
                                >
                                  Review all findings
                                  <ArrowRight size={15} />
                                </button>
                              </div>
                            )}
                          </section>
                          {project.source ? (
                            <section className="install-instructions">
                              <h3>Build before installing.</h3>
                              <p>The download preserves the repository and selected manifest proposals. Review its README, dependencies, and build scripts, then produce a Firefox build. Import that built ZIP into BridgeFox for packaging checks and test every feature in Firefox.</p>
                              <p>BridgeFox does not run repository scripts or compile TypeScript. Compatibility findings remain open.</p>
                            </section>
                          ) : <section className="install-instructions">
                            <div className="install-heading">
                              <span>
                                <FoxMark />
                              </span>
                              <div>
                                <span className="eyebrow">
                                  MAKE YOURSELF AT HOME
                                </span>
                                <h3>Let’s try it in Firefox.</h3>
                              </div>
                              <a
                                href="https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Your_first_WebExtension#installing"
                                target="_blank"
                                rel="noreferrer"
                                className="text-button"
                              >
                                The Mozilla guide
                                <ArrowUpRight size={15} />
                              </a>
                            </div>
                            <ol>
                              <li>
                                <span>01</span>
                                <div>
                                  <strong>Unpack your extension.</strong>
                                  <p>
                                    Extract the ZIP into a folder you can find
                                    again.
                                  </p>
                                </div>
                              </li>
                              <li>
                                <span>02</span>
                                <div>
                                  <strong>Open the Firefox workshop.</strong>
                                  <p>
                                    Visit{" "}
                                    <code>
                                      about:debugging#/runtime/this-firefox
                                    </code>
                                    .
                                  </p>
                                </div>
                              </li>
                              <li>
                                <span>03</span>
                                <div>
                                  <strong>Load it temporarily.</strong>
                                  <p>
                                    Choose <b>Load Temporary Add-on</b> and
                                    select <code>manifest.json</code>.
                                  </p>
                                </div>
                              </li>
                              <li>
                                <span>04</span>
                                <div>
                                  <strong>Give everything a try.</strong>
                                  <p>
                                    Test each feature and review any runtime
                                    errors.
                                  </p>
                                </div>
                              </li>
                            </ol>
                            <p className="install-footnote">
                              Temporary add-ons are removed when Firefox
                              restarts.
                            </p>
                          </section>}
                        </div>
                      ) : (
                        <div className="no-result">
                          <PackageArt />
                          <h2>A little preparation before we pack.</h2>
                          <p>
                            Generate a migration to see your validation report
                            and Firefox package.
                          </p>
                          <ActionButton
                            className="primary"
                            motionEnabled={animate}
                            onClick={() => go("report")}
                          >
                            Back to compatibility
                            <ArrowRight size={17} />
                          </ActionButton>
                        </div>
                      ))}
                  </>
                ) : null}
              </motion.div>
            </AnimatePresence>
            <footer className="page-footer">
              <span>
                <FoxMark small />
                Built for the browser you choose.
              </span>
              <span>
                BRIDGEFOX STUDIO <span>·</span>WITH OTARI
                <ArrowUpRight size={13} />
              </span>
            </footer>
          </div>
        </main>
        <dialog
          ref={dialog}
          className="modal"
          onCancel={() => setModal(null)}
          onClose={() => setModal(null)}
        >
          <div className="modal-header">
            <div>
              <span className="eyebrow">YOUR BRIDGEFOX</span>
              <h2>
                {modal === "settings"
                  ? "Make it feel like you."
                  : modal === "history"
                    ? "A moment in your journey."
                    : "Your first crossing."}
              </h2>
            </div>
            <button
              className="icon-button"
              aria-label="Close dialog"
              onClick={() => setModal(null)}
            >
              <X size={21} />
            </button>
          </div>
          <motion.div
            className="modal-body"
            initial={false}
            animate={
              modal && animate
                ? { opacity: [0, 1], y: [8, 0] }
                : { opacity: 1, y: 0 }
            }
            transition={{ duration: animate ? 0.2 : 0 }}
          >
            {modal === "settings" ? (
              <>
                <section className="appearance-settings">
                  <div className="settings-section-heading">
                    <Paintbrush size={18} />
                    <h3>Your kind of atmosphere.</h3>
                  </div>
                  <div
                    className="palette-options"
                    role="group"
                    aria-label="Color palette"
                  >
                    {palettes.map((p) => (
                      <button
                        className={`palette-option ${palette === p.id ? "chosen" : ""}`}
                        key={p.id}
                        aria-pressed={palette === p.id}
                        onClick={() => setPalette(p.id)}
                      >
                        <span
                          className="palette-preview"
                          style={{ background: p.colors[0] }}
                        >
                          <span style={{ background: p.colors[3] }} />
                          <i style={{ background: p.colors[2] }} />
                          <b style={{ background: p.colors[1] }} />
                        </span>
                        <strong>
                          {p.name}
                          {palette === p.id && <Check size={13} />}
                        </strong>
                        <small>{p.detail}</small>
                        <span className="palette-swatches">
                          {p.colors.map((color) => (
                            <span key={color} style={{ background: color }} />
                          ))}
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="motion-preference">
                    <div>
                      <strong>A little movement.</strong>
                      <p>
                        {reducedMotion
                          ? "Your device’s reduced-motion preference takes priority."
                          : "Gentle transitions, lively details. Your choice."}
                      </p>
                    </div>
                    <button
                      className={`switch ${motionEnabled ? "on" : ""}`}
                      role="switch"
                      aria-checked={motionEnabled}
                      aria-label="Enable interface animations"
                      onClick={() => setMotionEnabled(!motionEnabled)}
                    >
                      <motion.span
                        layout
                        transition={
                          animate
                            ? { type: "spring", stiffness: 500, damping: 30 }
                            : { duration: 0 }
                        }
                      />
                    </button>
                  </div>
                </section>
                <section className="gateway-settings">
                  <div className="settings-status">
                    <span>
                      <Zap size={22} />
                    </span>
                    <div>
                      <h3>Your Otari gateway.</h3>
                      <span
                        className={`badge ${config.configured ? "success" : "warning"}`}
                      >
                        {config.configured
                          ? "Configuration present · connection not checked"
                          : "A little setup needed"}
                      </span>
                    </div>
                  </div>
                  <p>
                    Configure the server’s <code>.env.local</code> and restart
                    the app. Your API keys stay on the server.
                  </p>
                  <dl className="settings-details">
                    <div>
                      <dt>Compatibility analyst</dt>
                      <dd>{config.analyst || "Not configured"}</dd>
                    </div>
                    <div>
                      <dt>Migration engineer</dt>
                      <dd>
                        {config.engineer || "Choose a second open-weight model"}
                      </dd>
                    </div>
                    <div>
                      <dt>Job spending threshold</dt>
                      <dd>{money(config.budgetUsd)}</dd>
                    </div>
                    <div>
                      <dt>Gateway guardrail</dt>
                      <dd>{config.guardrail || "No profile requested"}</dd>
                    </div>
                  </dl>
                  <p className="settings-note">
                    Two distinct open-weight models or routing policies.
                    Fallbacks and key spending limits are configured in Otari;
                    tool availability is checked when an AI job runs.
                  </p>
                  {(config.accessRequired || config.aiAccessRequired) && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        setPassword(passwordDraft);
                        setModal(null);
                      }}
                    >
                      <label className="settings-password">
                        Workspace access password
                        <input
                          type="password"
                          autoComplete="current-password"
                          value={passwordDraft}
                          onChange={(e) => setPasswordDraft(e.target.value)}
                        />
                      </label>
                      <ActionButton className="primary" motionEnabled={animate}>
                        Unlock this session
                        <ArrowRight size={16} />
                      </ActionButton>
                    </form>
                  )}
                  <a
                    className="text-button"
                    href="https://otari.ai/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open Otari
                    <ArrowUpRight size={15} />
                  </a>
                </section>
              </>
            ) : modal === "history" && historyItem ? (
              <>
                <span className="history-dialog-icon">
                  <FileCode2 size={26} />
                </span>
                <h3>{historyItem.name}</h3>
                <p>
                  {new Date(historyItem.date).toLocaleString()} ·{" "}
                  {historyItem.mode === "otari"
                    ? "Otari workflow requested"
                    : "Local rules"}
                </p>
                <dl className="settings-details">
                  <div>
                    <dt>Rule score</dt>
                    <dd>{historyItem.report.score} / 100</dd>
                  </div>
                  <div>
                    <dt>File proposals</dt>
                    <dd>{historyItem.patches}</dd>
                  </div>
                  <div>
                    <dt>Findings</dt>
                    <dd>{historyItem.report.findings.length}</dd>
                  </div>
                </dl>
                <p>
                  Your history keeps report metadata in this browser. Import the
                  source again to make another migration.
                </p>
                {historyItem.report.findings.map((f) => (
                  <p key={f.id}>
                    <strong>{f.title}</strong>
                    <br />
                    {f.detail}
                  </p>
                ))}
                <ActionButton
                  className="secondary"
                  motionEnabled={animate}
                  onClick={() =>
                    download(
                      new Blob([JSON.stringify(historyItem, null, 2)], {
                        type: "application/json",
                      }),
                      "bridgefox-history-report.json",
                    )
                  }
                >
                  <Download size={16} />
                  Download snapshot
                </ActionButton>
              </>
            ) : (
              <div className="guide">
                <p>
                  Bring a Chrome extension. Understand the differences. Give it
                  a new home in Firefox.
                </p>
                <ol>
                  <li>
                    <span>01</span>
                    <div>
                      <strong>Bring source you can modify.</strong>
                      <p>
                        A built ZIP or a source repository with browser manifest templates, up to 100 MB.
                      </p>
                    </div>
                  </li>
                  <li>
                    <span>02</span>
                    <div>
                      <strong>Get to know the differences.</strong>
                      <p>
                        Review API members, permissions, assets, and background
                        behavior.
                      </p>
                    </div>
                  </li>
                  <li>
                    <span>03</span>
                    <div>
                      <strong>Build a bridge you can inspect.</strong>
                      <p>
                        Start with local rules, or connect Otari for two-model
                        proposals and gateway activity.
                      </p>
                    </div>
                  </li>
                  <li>
                    <span>04</span>
                    <div>
                      <strong>See it work in Firefox.</strong>
                      <p>
                        Export, extract, and load <code>manifest.json</code>{" "}
                        with <code>about:debugging</code>. Try every feature.
                      </p>
                    </div>
                  </li>
                </ol>
                <div className="guide-note">
                  <CircleAlert size={20} />
                  <p>
                    Some Chrome-specific features need a redesign. BridgeFox
                    keeps those findings in view and blocks packaging when
                    blockers remain.
                  </p>
                </div>
                <ActionButton
                  className="primary"
                  motionEnabled={animate}
                  onClick={() => {
                    setModal(null);
                    void loadDemo();
                  }}
                  disabled={!!busy}
                >
                  Try the Tab Pocket example
                  <ArrowUpRight size={17} />
                </ActionButton>
              </div>
            )}
          </motion.div>
        </dialog>
      </div>
    </MotionConfig>
  );
}
