import { useEffect, useMemo, useRef, useState } from "react";
import { retimeWords } from "./caption-edit";
import { BackIcon, ExportIcon, PauseIcon, PlayIcon, SparkIcon } from "./icons";
import Home from "./Home";
import { parseProject } from "./project";
import { DEFAULT_EXPORT_SETTINGS } from "./export-settings";
import { STYLE_PRESETS } from "./presets";
import type { AppState, CaptionCue, CaptionProject, CaptionStyle, ExportSettings, JobProgress, ProjectSummary, WhisperModelStatus } from "./types";

const WHISPER_MODELS = [
  { id: "tiny", label: "Tiny · fastest" },
  { id: "base", label: "Base · quick" },
  { id: "small", label: "Small · recommended" },
  { id: "medium", label: "Medium · accurate" },
  { id: "turbo", label: "Turbo · best balance" }
];

const DEFAULT_WORD_TIMING_OFFSET_MS = 120;
const USER_STYLE_PRESETS_KEY = "captionforge:style-presets";

function loadLegacyState(): AppState {
  let project: CaptionProject | null = null;
  let userStylePresets: CaptionStyle[] = [];
  let exportSettings: ExportSettings | null = null;
  try {
    const draft = localStorage.getItem("captionforge:draft");
    project = draft ? JSON.parse(draft) as CaptionProject : null;
  } catch {
    // Ignore invalid data left by an older development build.
  }
  try {
    const stored = JSON.parse(localStorage.getItem(USER_STYLE_PRESETS_KEY) ?? "[]");
    userStylePresets = Array.isArray(stored)
      ? stored.filter((preset): preset is CaptionStyle => Boolean(preset?.id && preset?.name && preset?.fontFamily))
      : [];
  } catch {
    // Ignore invalid data left by an older development build.
  }
  try {
    const stored = localStorage.getItem("captionforge:export-settings");
    exportSettings = stored ? { ...DEFAULT_EXPORT_SETTINGS, ...JSON.parse(stored) } : null;
  } catch {
    // Ignore invalid data left by an older development build.
  }
  return { version: 1, project, userStylePresets, exportSettings };
}

// Electron prefixes errors thrown in the main process with
// "Error invoking remote method '<channel>': Error: ".
function errorMessage(reason: unknown) {
  const message = reason instanceof Error ? reason.message : String(reason);
  return message.replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, "");
}

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${remainder.toFixed(1).padStart(4, "0")}`;
}

function formatOffset(value: number) {
  if (value === 0) return "On anchor";
  return `${Math.abs(value)}% ${value > 0 ? "up" : "down"}`;
}

function formatWordTiming(value: number) {
  if (value === 0) return "On timestamp";
  return `${Math.abs(value)}ms ${value > 0 ? "early" : "late"}`;
}

function formatElapsed(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function FontPicker({
  fonts,
  value,
  onChange
}: {
  fonts: string[];
  value: string;
  onChange: (font: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filterQuery, setFilterQuery] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const pickerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const filteredFonts = useMemo(() => {
    const query = filterQuery?.trim().toLocaleLowerCase();
    if (!query) return fonts;
    return fonts.filter((font) => font.toLocaleLowerCase().includes(query));
  }, [filterQuery, fonts]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [open]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    pickerRef.current
      ?.querySelector<HTMLElement>(`[data-font-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  function openPicker() {
    setOpen(true);
    setFilterQuery(null);
    setActiveIndex(Math.max(0, fonts.indexOf(value)));
  }

  function selectFont(font: string) {
    onChange(font);
    setFilterQuery(null);
    setActiveIndex(fonts.indexOf(font));
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      inputRef.current?.select();
      return;
    }
    if (event.key === "Enter" && open) {
      event.preventDefault();
      const font = filteredFonts[activeIndex] ?? filteredFonts[0];
      if (font) selectFont(font);
      setOpen(false);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;

    event.preventDefault();
    if (!open) {
      openPicker();
      return;
    }
    if (!filteredFonts.length) return;
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const selectedIndex = filteredFonts.indexOf(value);
    const currentIndex = selectedIndex >= 0
      ? selectedIndex
      : direction > 0
        ? -1
        : 0;
    const nextIndex = (currentIndex + direction + filteredFonts.length) % filteredFonts.length;
    setActiveIndex(nextIndex);
    selectFont(filteredFonts[nextIndex]);
  }

  return (
    <div className="font-picker" ref={pickerRef}>
      <div className="font-picker-input-wrap">
        <input
          ref={inputRef}
          id="font-family"
          role="combobox"
          aria-autocomplete="list"
          aria-controls="font-options"
          aria-expanded={open}
          value={value}
          style={{ fontFamily: value }}
          onFocus={openPicker}
          onClick={openPicker}
          onKeyDown={handleKeyDown}
          onChange={(event) => {
            const nextValue = event.target.value;
            onChange(nextValue);
            setFilterQuery(nextValue);
            setActiveIndex(0);
            setOpen(true);
          }}
        />
        <button
          type="button"
          className="font-picker-toggle"
          aria-label={open ? "Close font list" : "Open font list"}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (open) {
              setOpen(false);
            } else {
              openPicker();
              inputRef.current?.focus();
            }
          }}
        >
          <span aria-hidden>⌄</span>
        </button>
      </div>
      {open && (
        <div className="font-picker-menu" id="font-options" role="listbox" aria-label="Installed fonts">
          {filteredFonts.length ? filteredFonts.map((font, index) => (
            <button
              type="button"
              role="option"
              aria-selected={font === value}
              className={font === value ? "selected" : ""}
              data-font-index={index}
              key={font}
              style={{ fontFamily: font }}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => {
                selectFont(font);
                setOpen(false);
                inputRef.current?.focus();
              }}
            >
              <span>{font}</span>
              <small>Aa</small>
            </button>
          )) : (
            <div className="font-picker-empty">{fonts.length ? "No matching fonts" : "Loading installed fonts…"}</div>
          )}
        </div>
      )}
    </div>
  );
}

function strictBatchCues(cues: CaptionCue[], batchSize: number): CaptionCue[] {
  const words = cues
    .flatMap((cue) => cue.words)
    .sort((a, b) => a.start - b.start);
  const size = Math.max(1, Math.floor(batchSize));
  const batches: CaptionCue[] = [];
  for (let index = 0; index < words.length; index += size) {
    const batch = words.slice(index, index + size);
    batches.push({
      id: crypto.randomUUID(),
      start: batch[0].start,
      end: batch.at(-1)!.end,
      text: batch.map((word) => word.text).join(" ").replace(/\s+([,.!?;:])/g, "$1"),
      words: batch
    });
  }
  return batches;
}

function App() {
  const [project, setProject] = useState<CaptionProject | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [recents, setRecents] = useState<ProjectSummary[] | null>(null);
  const [opening, setOpening] = useState(false);
  const persistedProjectRef = useRef<CaptionProject | null>(null);
  const [stateReady, setStateReady] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [activeTab, setActiveTab] = useState<"captions" | "style">("captions");
  const [model, setModel] = useState("turbo");
  const [modelStatus, setModelStatus] = useState<WhisperModelStatus[]>([]);
  const [language, setLanguage] = useState("auto");
  const [wordsPerCue, setWordsPerCue] = useState(3);
  const [job, setJob] = useState<JobProgress | null>(null);
  const [jobElapsedSeconds, setJobElapsedSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [previewStatus, setPreviewStatus] = useState<"ready" | "preparing" | "failed">("ready");
  const [fonts, setFonts] = useState<string[]>([]);
  const [userStylePresets, setUserStylePresets] = useState<CaptionStyle[]>([]);
  const [presetSaveOpen, setPresetSaveOpen] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [selectedCueIds, setSelectedCueIds] = useState<Set<string>>(() => new Set());
  const [exportOpen, setExportOpen] = useState(false);
  const [exportSettings, setExportSettings] = useState<ExportSettings>(DEFAULT_EXPORT_SETTINGS);
  const videoRef = useRef<HTMLVideoElement>(null);
  const seekTargetRef = useRef<number | null>(null);
  const previewPathRef = useRef(previewPath);
  const previewStatusRef = useRef(previewStatus);
  const presetNameInputRef = useRef<HTMLInputElement>(null);
  const lastSelectedCueIdRef = useRef<string | null>(null);
  const jobStartedAtRef = useRef(0);

  previewPathRef.current = previewPath;
  previewStatusRef.current = previewStatus;

  useEffect(() => window.captionForge.onProgress(setJob), []);
  useEffect(() => { refreshModelStatus(); }, []);
  useEffect(() => {
    let cancelled = false;
    window.captionForge.loadState(loadLegacyState())
      .then(async (state) => {
        if (cancelled) return;
        // Older versions kept one draft in the app state; move it into the
        // project library so it shows up under recent projects.
        if (state.project) {
          try {
            await window.captionForge.createProject(parseProject(state.project, STYLE_PRESETS[0]));
          } catch (reason) {
            setError(`Your last draft couldn't be restored: ${errorMessage(reason)}`);
          }
        }
        if (cancelled) return;
        refreshRecents();
        setUserStylePresets(state.userStylePresets);
        setExportSettings({ ...DEFAULT_EXPORT_SETTINGS, ...state.exportSettings });
        setStateReady(true);
      })
      .catch((reason) => {
        if (cancelled) return;
        setError(`Could not load app settings: ${errorMessage(reason)}`);
        setStateReady(true);
      });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!stateReady) return;
    const timeout = window.setTimeout(() => {
      window.captionForge.saveState({
        version: 1,
        project: null,
        userStylePresets,
        exportSettings
      }).catch((reason) => {
        setError(`Could not save app settings: ${errorMessage(reason)}`);
      });
    }, 150);
    return () => window.clearTimeout(timeout);
  }, [stateReady, userStylePresets, exportSettings]);
  // Autosave the open project into the library.
  useEffect(() => {
    if (!project || !projectId || persistedProjectRef.current === project) return;
    const timeout = window.setTimeout(() => { persistProject(projectId, project); }, 250);
    return () => window.clearTimeout(timeout);
  }, [project, projectId]);
  useEffect(() => {
    document.title = project ? `${project.video.name} — CaptionForge` : "CaptionForge";
  }, [project?.video.name]);
  useEffect(() => {
    if (presetSaveOpen) presetNameInputRef.current?.focus();
  }, [presetSaveOpen]);
  useEffect(() => {
    if (!job) {
      setJobElapsedSeconds(0);
      return;
    }
    if (!jobStartedAtRef.current) jobStartedAtRef.current = Date.now();
    const updateElapsed = () => setJobElapsedSeconds(Math.floor((Date.now() - jobStartedAtRef.current) / 1000));
    updateElapsed();
    const interval = window.setInterval(updateElapsed, 500);
    return () => window.clearInterval(interval);
  }, [Boolean(job)]);
  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timeout);
  }, [toast]);
  useEffect(() => {
    previewPathRef.current = project?.video.path ?? null;
    previewStatusRef.current = "ready";
    setPreviewPath(project?.video.path ?? null);
    setPreviewStatus("ready");
  }, [project?.video.path]);
  useEffect(() => {
    if (activeTab === "style" && !fonts.length) {
      window.captionForge.listFonts?.().then(setFonts).catch(() => undefined);
    }
  }, [activeTab, fonts.length]);
  useEffect(() => {
    if (!project) return;
    const availableIds = new Set(project.cues.map((cue) => cue.id));
    setSelectedCueIds((selected) => {
      const next = new Set([...selected].filter((id) => availableIds.has(id)));
      return next.size === selected.size ? selected : next;
    });
  }, [project?.cues]);
  useEffect(() => {
    if (!selectedCueIds.size) return;
    const handleDelete = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      deleteSelectedCues();
    };
    window.addEventListener("keydown", handleDelete);
    return () => window.removeEventListener("keydown", handleDelete);
  }, [selectedCueIds, project]);
  useEffect(() => {
    if (!playing) return;
    const video = videoRef.current;
    if (!video) return;

    let callbackId = 0;
    let animationFrameId = 0;
    const syncTime = () => {
      setCurrentTime(video.currentTime);
      if ("requestVideoFrameCallback" in video) {
        callbackId = video.requestVideoFrameCallback(syncTime);
      } else {
        animationFrameId = window.requestAnimationFrame(syncTime);
      }
    };

    if ("requestVideoFrameCallback" in video) {
      callbackId = video.requestVideoFrameCallback(syncTime);
    } else {
      animationFrameId = window.requestAnimationFrame(syncTime);
    }

    return () => {
      if ("cancelVideoFrameCallback" in video && callbackId) {
        video.cancelVideoFrameCallback(callbackId);
      }
      if (animationFrameId) window.cancelAnimationFrame(animationFrameId);
    };
  }, [playing]);

  const activeCue = useMemo(
    () => project?.cues.find((cue) => currentTime >= cue.start && currentTime < cue.end),
    [project?.cues, currentTime]
  );
  const activeWordTimingOffsetMs = project?.style.wordTimingOffsetMs ?? DEFAULT_WORD_TIMING_OFFSET_MS;
  const activeWordId = activeCue?.words.find((word, index, words) => {
    const previewTime = currentTime + activeWordTimingOffsetMs / 1000;
    return previewTime >= word.start && previewTime < (words[index + 1]?.start ?? activeCue.end);
  })?.id ?? activeCue?.words[0]?.id;

  function refreshRecents() {
    window.captionForge.listProjects().then(setRecents).catch((reason) => {
      setRecents([]);
      setError(`Could not load recent projects: ${errorMessage(reason)}`);
    });
  }

  async function persistProject(id: string, next: CaptionProject) {
    persistedProjectRef.current = next;
    try {
      await window.captionForge.saveLibraryProject(id, next);
    } catch (reason) {
      persistedProjectRef.current = null;
      setError(`Could not save your changes: ${errorMessage(reason)}`);
    }
  }

  function enterProject(id: string, next: CaptionProject) {
    persistedProjectRef.current = next;
    setProjectId(id);
    setProject(next);
    setCurrentTime(0);
    setPlaying(false);
    seekTargetRef.current = null;
    setSelectedCueIds(new Set());
    lastSelectedCueIdRef.current = null;
    setActiveTab("captions");
  }

  // Runs a home-screen action with the buttons disabled and errors shown.
  async function homeAction(action: () => Promise<void>) {
    setError(null);
    setOpening(true);
    try {
      await action();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setOpening(false);
    }
  }

  function newProjectFromVideo() {
    return homeAction(async () => {
      const video = await window.captionForge.openVideo();
      if (!video) return;
      const created: CaptionProject = { version: 1, video, language: "auto", cues: [], style: { ...STYLE_PRESETS[0] } };
      enterProject(await window.captionForge.createProject(created), created);
    });
  }

  function openRecentProject(id: string) {
    return homeAction(async () => {
      const opened = await window.captionForge.openLibraryProject(id);
      enterProject(opened.id, parseProject(opened.project, STYLE_PRESETS[0]));
    });
  }

  function openProjectFile() {
    return homeAction(async () => {
      const opened = await window.captionForge.openProject();
      if (!opened) return;
      const parsed = parseProject(opened.data, STYLE_PRESETS[0]);
      const id = await window.captionForge.importProject(parsed, opened.filePath, opened.modifiedAt);
      const entry = await window.captionForge.openLibraryProject(id);
      enterProject(id, parseProject(entry.project, STYLE_PRESETS[0]));
    });
  }

  function removeRecentProject(id: string) {
    return homeAction(async () => {
      await window.captionForge.removeProject(id);
      setRecents((current) => current?.filter((item) => item.id !== id) ?? null);
    });
  }

  async function goHome() {
    videoRef.current?.pause();
    if (project && projectId && persistedProjectRef.current !== project) await persistProject(projectId, project);
    setProject(null);
    setProjectId(null);
    persistedProjectRef.current = null;
    setExportOpen(false);
    refreshRecents();
  }

  function refreshModelStatus() {
    window.captionForge.listModels().then(setModelStatus).catch(() => setModelStatus([]));
  }

  function modelOptionLabel(id: string, label: string) {
    const status = modelStatus.find((item) => item.id === id);
    if (!status) return label;
    return status.installed ? `${label} · downloaded` : `${label} · ${Math.round(status.size / 1_000_000)} MB`;
  }

  async function transcribe() {
    if (!project) return;
    setError(null);
    jobStartedAtRef.current = Date.now();
    setJob({ stage: "audio", value: 0, message: "Starting…" });
    try {
      const result = await window.captionForge.transcribe({
        videoPath: project.video.path,
        model,
        language,
        wordsPerCue
      });
      setProject({ ...project, language: result.language, cues: result.cues });
      setSelectedCueIds(new Set());
      setToast(`${result.cues.length} caption groups created`);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setJob(null);
      jobStartedAtRef.current = 0;
      refreshModelStatus();
    }
  }

  async function exportVideo() {
    if (!project || !project.cues.length) return;
    setExportOpen(false);
    setError(null);
    jobStartedAtRef.current = Date.now();
    setJob({ stage: "export", value: 0, message: "Preparing export…" });
    try {
      const output = await window.captionForge.exportVideo(project, exportSettings);
      if (output) setToast(`Exported ${output.split("/").at(-1)}`);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setJob(null);
      jobStartedAtRef.current = 0;
    }
  }

  function updateStyle(patch: Partial<CaptionStyle>) {
    if (!project) return;
    setProject({ ...project, style: { ...project.style, ...patch, id: "custom", name: "Custom" } });
  }

  function applyStylePreset(id: string) {
    const preset = [...STYLE_PRESETS, ...userStylePresets].find((candidate) => candidate.id === id);
    if (preset && project) setProject({ ...project, style: { ...preset } });
  }

  function beginStylePresetSave() {
    const suggestedName = style.name === "Custom" ? "My caption style" : `${style.name} copy`;
    setPresetName(suggestedName);
    setPresetSaveOpen(true);
  }

  function saveStylePreset(event: React.FormEvent) {
    event.preventDefault();
    if (!project) return;
    const name = presetName.trim();
    if (!name) return;
    const matchingPreset = userStylePresets.find((preset) => preset.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    const preset: CaptionStyle = {
      ...style,
      id: matchingPreset?.id ?? `user-${crypto.randomUUID()}`,
      name
    };
    setUserStylePresets((presets) => matchingPreset
      ? presets.map((candidate) => candidate.id === matchingPreset.id ? preset : candidate)
      : [...presets, preset]);
    setProject({ ...project, style: preset });
    setPresetSaveOpen(false);
    setPresetName("");
    setToast(`${matchingPreset ? "Updated" : "Saved"} style preset “${name}”`);
  }

  function updateCue(id: string, text: string) {
    if (!project) return;
    setProject({
      ...project,
      cues: project.cues.map((cue) => cue.id === id ? retimeWords(cue, text) : cue)
    });
  }

  function applyStrictBatches() {
    if (!project) return;
    const cues = strictBatchCues(project.cues, wordsPerCue);
    setProject({ ...project, cues });
    setToast(`Rebatched into ${cues.length} strict ${wordsPerCue}-word groups`);
  }

  function selectTimelineCue(cue: CaptionCue, event: React.MouseEvent<HTMLButtonElement>) {
    if (!project) return;
    const additive = event.metaKey || event.ctrlKey;
    const lastIndex = project.cues.findIndex((candidate) => candidate.id === lastSelectedCueIdRef.current);
    const nextIndex = project.cues.findIndex((candidate) => candidate.id === cue.id);

    setSelectedCueIds((selected) => {
      if (event.shiftKey && lastIndex >= 0 && nextIndex >= 0) {
        const [start, end] = [Math.min(lastIndex, nextIndex), Math.max(lastIndex, nextIndex)];
        const next = additive ? new Set(selected) : new Set<string>();
        project.cues.slice(start, end + 1).forEach((candidate) => next.add(candidate.id));
        return next;
      }
      if (additive) {
        const next = new Set(selected);
        if (next.has(cue.id)) next.delete(cue.id);
        else next.add(cue.id);
        return next;
      }
      return new Set([cue.id]);
    });
    lastSelectedCueIdRef.current = cue.id;
    seek(cue.start);
  }

  function deleteSelectedCues() {
    if (!project || !selectedCueIds.size) return;
    const count = selectedCueIds.size;
    setProject({ ...project, cues: project.cues.filter((cue) => !selectedCueIds.has(cue.id)) });
    setSelectedCueIds(new Set());
    lastSelectedCueIdRef.current = null;
    setToast(`Removed ${count} caption${count === 1 ? "" : "s"}`);
  }

  function seek(time: number) {
    const duration = project?.video.duration || 0;
    const target = Math.max(0, Math.min(Number.isFinite(time) ? time : 0, duration));
    seekTargetRef.current = target;
    setCurrentTime(target);
    const video = videoRef.current;
    if (!video || video.readyState < HTMLMediaElement.HAVE_METADATA) return;
    const mediaDuration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : duration;
    video.currentTime = Math.min(target, mediaDuration);
  }

  function handleLoadedMetadata(video: HTMLVideoElement) {
    const target = seekTargetRef.current;
    if (target == null) return;
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : project?.video.duration ?? 0;
    video.currentTime = Math.min(target, duration);
  }

  function handleVideoTimeUpdate(video: HTMLVideoElement) {
    const target = seekTargetRef.current;
    if (target != null && Math.abs(video.currentTime - target) > 0.2) return;
    setCurrentTime(video.currentTime);
  }

  function handleSeeked(video: HTMLVideoElement) {
    const target = seekTargetRef.current;
    if (target != null && Math.abs(video.currentTime - target) > 0.25) return;
    seekTargetRef.current = null;
    setCurrentTime(video.currentTime);
  }

  async function recoverPreview(targetTime = currentTime, failedPath = previewPathRef.current, mediaError?: string) {
    if (!project || failedPath !== previewPathRef.current) return;
    if (previewStatusRef.current !== "ready" || failedPath !== project.video.path) {
      if (previewStatusRef.current === "preparing") return;
      previewStatusRef.current = "failed";
      setPreviewStatus("failed");
      setError(`Preview playback failed${mediaError ? `: ${mediaError}` : "."}`);
      return;
    }
    previewStatusRef.current = "preparing";
    setPreviewStatus("preparing");
    const createPreview = window.captionForge.createPreview;
    if (typeof createPreview !== "function") {
      setPreviewStatus("failed");
      setError("The preview helper needs an app restart. Save the project, close CaptionForge, and run npm run dev again.");
      return;
    }
    try {
      const proxyPath = await createPreview(project.video.path);
      seekTargetRef.current = targetTime;
      setCurrentTime(targetTime);
      previewPathRef.current = proxyPath;
      previewStatusRef.current = "ready";
      setPreviewPath(proxyPath);
      setPreviewStatus("ready");
    } catch (reason) {
      previewStatusRef.current = "failed";
      setPreviewStatus("failed");
      setError(`Preview conversion failed: ${errorMessage(reason)}`);
    }
  }

  const errorToast = error && <div className="error-toast"><strong>Something went wrong</strong><span>{error}</span><button onClick={() => setError(null)}>×</button></div>;

  if (!project) {
    return (
      <Home
        recents={recents}
        busy={opening || !stateReady}
        onNewProject={newProjectFromVideo}
        onOpenFile={openProjectFile}
        onOpenRecent={openRecentProject}
        onRemove={removeRecentProject}
      >
        {errorToast}
      </Home>
    );
  }

  const style = project.style;
  const verticalOffset = style.verticalOffsetPercent ?? 0;
  const wordTimingOffsetMs = style.wordTimingOffsetMs ?? DEFAULT_WORD_TIMING_OFFSET_MS;
  const letterSpacing = style.letterSpacing ?? 0;
  const fontStyle = style.fontStyle ?? "normal";
  const anchorY = style.position === "top"
    ? 10
    : style.position === "bottom"
      ? 100 - (style.marginPercent ?? 12)
      : 50;
  const captionY = Math.max(0, Math.min(100, anchorY - verticalOffset));
  const assFontMetricScale = 0.82;
  const sourcePixelsToPreview = (pixels: number) =>
    `${pixels * 100 / project.video.height}cqh`;
  const previewShadow = style.shadow > 0
    ? `${sourcePixelsToPreview(style.shadow)} ${sourcePixelsToPreview(style.shadow)} 0 rgba(0,0,0,.44)`
    : "none";
  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="topbar-start">
          <button className="home-button" disabled={Boolean(job)} onClick={goHome} title="Back to all projects"><BackIcon /> Projects</button>
        </div>
        <div className="project-title">
          <strong>{project.video.name}</strong>
          <span>{project.video.width}×{project.video.height} · {formatTime(project.video.duration)}</span>
        </div>
        <div className="top-actions">
          <button className="ghost" onClick={() => window.captionForge.saveProject(project)}>Save project</button>
          <button className="primary" disabled={!project.cues.length || Boolean(job)} onClick={() => setExportOpen(true)}><ExportIcon /> Export video</button>
        </div>
      </header>

      <section className="workspace">
        <aside className="sidebar">
          <div className="tabs">
            <button className={activeTab === "captions" ? "active" : ""} onClick={() => setActiveTab("captions")}>Captions</button>
            <button className={activeTab === "style" ? "active" : ""} onClick={() => setActiveTab("style")}>Style</button>
          </div>

          {activeTab === "captions" ? (
            <div className="panel-body">
              {!project.cues.length ? (
                <div className="transcribe-card">
                  <div className="panel-icon"><SparkIcon size={22} /></div>
                  <h2>Generate captions</h2>
                  <p>Whisper runs locally. Each model downloads once, the first time you use it.</p>
                  <label>Model
                    <select value={model} onChange={(event) => setModel(event.target.value)}>
                      {WHISPER_MODELS.map((item) => (
                        <option key={item.id} value={item.id}>{modelOptionLabel(item.id, item.label)}</option>
                      ))}
                    </select>
                  </label>
                  <label>Language
                    <select value={language} onChange={(event) => setLanguage(event.target.value)}>
                      <option value="auto">Detect automatically</option>
                      <option value="en">English</option>
                      <option value="es">Spanish</option>
                      <option value="fr">French</option>
                      <option value="de">German</option>
                      <option value="pt">Portuguese</option>
                      <option value="it">Italian</option>
                      <option value="ja">Japanese</option>
                      <option value="ko">Korean</option>
                      <option value="zh">Chinese</option>
                    </select>
                  </label>
                  <label>Words per caption <output>{wordsPerCue}</output>
                    <input type="range" min="1" max="6" value={wordsPerCue} onChange={(event) => setWordsPerCue(Number(event.target.value))} />
                  </label>
                  <button className="primary full" disabled={Boolean(job)} onClick={transcribe}><SparkIcon /> Transcribe video</button>
                </div>
              ) : (
                <div className="cue-list">
                  <div className="list-heading list-heading-batches">
                    <span>{project.cues.length} caption groups</span>
                    <div className="batch-actions">
                      <select aria-label="Words per batch" value={wordsPerCue} onChange={(event) => setWordsPerCue(Number(event.target.value))}>
                        {[1, 2, 3, 4, 5, 6].map((count) => <option key={count} value={count}>{count} words</option>)}
                      </select>
                      <button onClick={applyStrictBatches}>Apply batches</button>
                      <button onClick={transcribe}>Retranscribe</button>
                    </div>
                  </div>
                  {project.cues.map((cue, index) => (
                    <button key={cue.id} className={`cue-row ${activeCue?.id === cue.id ? "active" : ""}`} onClick={() => seek(cue.start)}>
                      <span className="cue-number">{String(index + 1).padStart(2, "0")}</span>
                      <span className="cue-content">
                        <textarea
                          value={cue.text}
                          rows={Math.max(1, Math.ceil(cue.text.length / 27))}
                          onClick={(event) => event.stopPropagation()}
                          onChange={(event) => updateCue(cue.id, event.target.value)}
                        />
                        <small>{formatTime(cue.start)} — {formatTime(cue.end)}</small>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="panel-body style-panel">
              <h3>Presets</h3>
              <div className="preset-controls">
                <select aria-label="Caption style preset" value={[...STYLE_PRESETS, ...userStylePresets].some((preset) => preset.id === style.id) ? style.id : "custom"} onChange={(event) => applyStylePreset(event.target.value)}>
                  <option value="custom" disabled>Custom (unsaved)</option>
                  <optgroup label="Built-in presets">
                    {STYLE_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
                  </optgroup>
                  {userStylePresets.length > 0 && <optgroup label="My presets">
                    {userStylePresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
                  </optgroup>}
                </select>
                {!presetSaveOpen && <button type="button" onClick={beginStylePresetSave}>Save current</button>}
                {presetSaveOpen && <form className="preset-save-form" onSubmit={saveStylePreset}>
                  <label htmlFor="preset-name">Preset name</label>
                  <input
                    ref={presetNameInputRef}
                    id="preset-name"
                    value={presetName}
                    placeholder="My caption style"
                    onChange={(event) => setPresetName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        setPresetSaveOpen(false);
                        setPresetName("");
                      }
                    }}
                  />
                  <div className="preset-save-actions">
                    <button type="button" onClick={() => {
                      setPresetSaveOpen(false);
                      setPresetName("");
                    }}>Cancel</button>
                    <button type="submit" disabled={!presetName.trim()}>Save preset</button>
                  </div>
                </form>}
              </div>
              <h3>Typography</h3>
              <div className="font-field">
                <label htmlFor="font-family">Font</label>
                <FontPicker fonts={fonts} value={style.fontFamily} onChange={(fontFamily) => updateStyle({ fontFamily })} />
              </div>
              <div className="font-sample" style={{ fontFamily: style.fontFamily, fontStyle, fontWeight: style.fontWeight }}>
                Make every word land.
                <small>{fonts.length ? `${fonts.length} installed fonts available` : "Loading installed fonts…"}</small>
              </div>
              <label>Size <output>{style.fontSize}px</output>
                <input type="range" min="24" max="240" step="1" value={style.fontSize} onChange={(event) => updateStyle({ fontSize: Number(event.target.value) })} />
              </label>
              <label>Weight
                <select value={style.fontWeight} onChange={(event) => updateStyle({ fontWeight: Number(event.target.value) })}>
                  <option value="400">Regular</option><option value="500">Medium</option><option value="700">Bold</option><option value="800">Extra bold</option><option value="900">Black</option>
                </select>
              </label>
              <label className="check-row"><input type="checkbox" checked={fontStyle === "italic"} onChange={(event) => updateStyle({ fontStyle: event.target.checked ? "italic" : "normal" })} /> Italic</label>
              <label>Letter spacing <output>{letterSpacing}px</output>
                <input type="range" min="-3" max="12" step="1" value={letterSpacing} onChange={(event) => updateStyle({ letterSpacing: Number(event.target.value) })} />
              </label>
              <div className="color-row">
                <label>Text<input type="color" value={style.primaryColor} onChange={(event) => updateStyle({ primaryColor: event.target.value })} /></label>
                <label>Active<input type="color" value={style.activeColor} onChange={(event) => updateStyle({ activeColor: event.target.value })} /></label>
                <label>Outline<input type="color" value={style.outlineColor} onChange={(event) => updateStyle({ outlineColor: event.target.value })} /></label>
              </div>
              <label>Outline <output>{style.outlineWidth}px</output>
                <input type="range" min="0" max="20" step="0.5" value={style.outlineWidth} onChange={(event) => updateStyle({ outlineWidth: Number(event.target.value) })} />
              </label>
              <label>Shadow <output>{style.shadow}px</output>
                <input type="range" min="0" max="10" value={style.shadow} onChange={(event) => updateStyle({ shadow: Number(event.target.value) })} />
              </label>
              <h3>Motion & layout</h3>
              <label>Position
                <div className="segmented">
                  {(["top", "center", "bottom"] as const).map((position) => <button key={position} className={style.position === position ? "active" : ""} onClick={() => updateStyle({ position })}>{position}</button>)}
                </div>
              </label>
              <label>Vertical offset <output>{formatOffset(verticalOffset)}</output>
                <input type="range" min="-40" max="40" step="0.5" value={verticalOffset} onChange={(event) => updateStyle({ verticalOffsetPercent: Number(event.target.value) })} />
                <span className="range-hints"><span>Down</span><button type="button" onClick={() => updateStyle({ verticalOffsetPercent: 0 })}>Reset</button><span>Up</span></span>
              </label>
              <label>Word transition
                <select value={style.transition} onChange={(event) => updateStyle({ transition: event.target.value as CaptionStyle["transition"] })}>
                  <option value="none">None</option><option value="pop">Pop</option><option value="fade">Fade</option>
                </select>
              </label>
              <label>Active word timing <output>{formatWordTiming(wordTimingOffsetMs)}</output>
                <span className="range-with-number">
                  <input type="range" min="-500" max="500" step="5" value={wordTimingOffsetMs} onChange={(event) => updateStyle({ wordTimingOffsetMs: Number(event.target.value) })} />
                  <input
                    type="number"
                    aria-label="Active word timing in milliseconds"
                    min="-500"
                    max="500"
                    step="1"
                    value={wordTimingOffsetMs}
                    onChange={(event) => {
                      const value = event.target.valueAsNumber;
                      if (Number.isFinite(value)) updateStyle({ wordTimingOffsetMs: Math.max(-500, Math.min(500, value)) });
                    }}
                  />
                </span>
                <span className="range-hints"><span>Later</span><button type="button" onClick={() => updateStyle({ wordTimingOffsetMs: DEFAULT_WORD_TIMING_OFFSET_MS })}>Reset to 120ms</button><span>Earlier</span></span>
              </label>
              <label className="check-row"><input type="checkbox" checked={style.highlightActiveWord} onChange={(event) => updateStyle({ highlightActiveWord: event.target.checked })} /> Highlight active word</label>
              <label className="check-row"><input type="checkbox" checked={style.uppercase} onChange={(event) => updateStyle({ uppercase: event.target.checked })} /> Uppercase captions</label>
            </div>
          )}
        </aside>

        <section className="stage">
          <div className="canvas-wrap">
            <div className="video-frame" style={{ aspectRatio: `${project.video.width}/${project.video.height}` }}>
              <video
                ref={videoRef}
                src={previewPath ? window.captionForge.mediaUrl(previewPath) : undefined}
                onError={(event) => recoverPreview(currentTime, previewPath, event.currentTarget.error?.message)}
                onLoadedMetadata={(event) => handleLoadedMetadata(event.currentTarget)}
                onTimeUpdate={(event) => handleVideoTimeUpdate(event.currentTarget)}
                onSeeked={(event) => handleSeeked(event.currentTarget)}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
              />
              {previewStatus === "preparing" && <div className="preview-message"><SparkIcon size={20} /> Preparing a smooth editing preview…</div>}
              {previewStatus === "failed" && <div className="preview-message">Preview unavailable. Export can still use the original video.</div>}
              {activeCue && (
                <div className={`caption-preview pos-${style.position} transition-${style.transition}`} style={{
                  fontFamily: style.fontFamily,
                  fontWeight: style.fontWeight,
                  fontStyle,
                  fontSynthesis: "weight style",
                  color: style.primaryColor,
                  WebkitTextStroke: `${sourcePixelsToPreview(style.outlineWidth * 2)} ${style.outlineColor}`,
                  textShadow: previewShadow,
                  fontSize: sourcePixelsToPreview(style.fontSize * assFontMetricScale),
                  letterSpacing: sourcePixelsToPreview(letterSpacing),
                  textTransform: style.uppercase ? "uppercase" : "none",
                  top: `${captionY}%`
                }}>
                  {activeCue.words.map((word) => (
                    <span
                      key={word.id}
                      className={`caption-word ${style.highlightActiveWord && word.id === activeWordId ? "word-active" : ""}`}
                      style={style.highlightActiveWord && word.id === activeWordId ? { color: style.activeColor } : undefined}
                    >
                      {word.text}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="transport">
            <button className="play-button" onClick={() => playing ? videoRef.current?.pause() : videoRef.current?.play()}>{playing ? <PauseIcon /> : <PlayIcon />}</button>
            <span>{formatTime(currentTime)}</span>
            <input aria-label="Video position" type="range" min="0" max={project.video.duration || 1} step="0.01" value={currentTime} onChange={(event) => seek(Number(event.target.value))} />
            <span>{formatTime(project.video.duration)}</span>
          </div>
          <div className="timeline">
            <div className="timeline-ruler"><span>00:00</span><span>{formatTime(project.video.duration / 2)}</span><span>{formatTime(project.video.duration)}</span></div>
            <div className="timeline-toolbar">
              <span>{selectedCueIds.size ? `${selectedCueIds.size} caption${selectedCueIds.size === 1 ? "" : "s"} selected` : "Click a caption · Shift-click to select a range"}</span>
              <button type="button" disabled={!selectedCueIds.size} onClick={deleteSelectedCues}>Delete selected</button>
            </div>
            <div className="timeline-track" onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              setSelectedCueIds(new Set());
              lastSelectedCueIdRef.current = null;
              seek(((event.clientX - rect.left) / rect.width) * project.video.duration);
            }}>
              {project.cues.map((cue, index) => <button
                type="button"
                key={cue.id}
                className={`timeline-cue ${activeCue?.id === cue.id ? "active" : ""} ${selectedCueIds.has(cue.id) ? "selected" : ""}`}
                aria-label={`Caption ${index + 1}: ${cue.text}`}
                aria-pressed={selectedCueIds.has(cue.id)}
                title={`${cue.text}\n${formatTime(cue.start)} — ${formatTime(cue.end)}`}
                style={{ left: `${cue.start / project.video.duration * 100}%`, width: `${Math.max(0.4, (cue.end - cue.start) / project.video.duration * 100)}%` }}
                onClick={(event) => {
                  event.stopPropagation();
                  selectTimelineCue(cue, event);
                }}
              />)}
              <i style={{ left: `${currentTime / project.video.duration * 100}%` }} />
            </div>
          </div>
        </section>
      </section>

      {exportOpen && <div className="modal-overlay" onMouseDown={(event) => {
        if (event.target === event.currentTarget) setExportOpen(false);
      }}>
        <section className="export-modal" role="dialog" aria-modal="true" aria-labelledby="export-title">
          <div className="modal-heading">
            <div>
              <span className="eyebrow">Export settings</span>
              <h2 id="export-title">Finish your video</h2>
              <p>These settings are remembered for your next export.</p>
            </div>
            <button className="modal-close" aria-label="Close export settings" onClick={() => setExportOpen(false)}>×</button>
          </div>
          <div className="export-grid">
            <label>Resolution
              <select value={exportSettings.resolution} onChange={(event) => setExportSettings({ ...exportSettings, resolution: event.target.value as ExportSettings["resolution"] })}>
                <option value="source">Source · {project.video.width}×{project.video.height}</option>
                <option value="1080">Full HD · up to 1080×1920</option>
                <option value="720">HD · up to 720×1280</option>
              </select>
            </label>
            <label>Quality
              <select value={exportSettings.quality} onChange={(event) => setExportSettings({ ...exportSettings, quality: event.target.value as ExportSettings["quality"] })}>
                <option value="draft">Draft · fastest</option>
                <option value="balanced">Balanced · recommended</option>
                <option value="high">High · largest file</option>
              </select>
            </label>
            <label>Video codec
              <select value={exportSettings.codec} onChange={(event) => setExportSettings({ ...exportSettings, codec: event.target.value as ExportSettings["codec"] })}>
                <option value="h264">H.264 · most compatible</option>
                <option value="hevc">HEVC · smaller file</option>
              </select>
            </label>
            <label>Frame rate
              <select value={exportSettings.frameRate} onChange={(event) => setExportSettings({ ...exportSettings, frameRate: event.target.value as ExportSettings["frameRate"] })}>
                <option value="source">Match source · {project.video.fps.toFixed(2)} fps</option>
                <option value="24">24 fps</option>
                <option value="30">30 fps</option>
                <option value="60">60 fps</option>
              </select>
            </label>
            <label>Audio quality
              <select value={exportSettings.audioBitrate} onChange={(event) => setExportSettings({ ...exportSettings, audioBitrate: Number(event.target.value) as ExportSettings["audioBitrate"] })}>
                <option value="128">128 kbps</option>
                <option value="192">192 kbps · recommended</option>
                <option value="320">320 kbps</option>
              </select>
            </label>
            <label className="hardware-option">
              <span><strong>Hardware acceleration</strong><small>Try your GPU first, with an automatic safe fallback.</small></span>
              <input type="checkbox" checked={exportSettings.hardwareAcceleration} onChange={(event) => setExportSettings({ ...exportSettings, hardwareAcceleration: event.target.checked })} />
            </label>
          </div>
          <div className="export-summary">
            <span>{exportSettings.codec === "h264" ? "H.264" : "HEVC"}</span>
            <span>{exportSettings.resolution === "source" ? "Source resolution" : `${exportSettings.resolution}p`}</span>
            <span>{exportSettings.frameRate === "source" ? "Source fps" : `${exportSettings.frameRate} fps`}</span>
          </div>
          <div className="modal-actions">
            <button className="ghost" onClick={() => setExportOpen(false)}>Cancel</button>
            <button className="primary" onClick={exportVideo}><ExportIcon /> Choose location & export</button>
          </div>
        </section>
      </div>}
      {job && <div className="job-overlay">
        <div className={`job-card job-${job.stage}`} aria-live="polite"><SparkIcon size={24} /><strong>{job.message}</strong><small>{Math.round(job.value * 100)}% · Working locally · {formatElapsed(jobElapsedSeconds)}</small><div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(job.value * 100)}><span style={{ width: `${job.value * 100}%` }} /></div><button onClick={() => window.captionForge.cancelJob()}>Cancel</button></div>
      </div>}
      {errorToast}
      {toast && <div className="success-toast">{toast}</div>}
    </main>
  );
}

export default App;
