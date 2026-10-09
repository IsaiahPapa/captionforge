import { useState, type ReactNode } from "react";
import { FileIcon, FolderIcon, SparkIcon } from "./icons";
import type { ProjectSummary } from "./types";

interface HomeProps {
  recents: ProjectSummary[] | null;
  busy: boolean;
  onNewProject(): void;
  onOpenFile(): void;
  onOpenRecent(id: string): void;
  onRemove(id: string): void;
  children?: ReactNode;
}

function formatDuration(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

const relativeTime = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

function formatEdited(timestamp: number) {
  const seconds = (timestamp - Date.now()) / 1000;
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [["day", 86400], ["hour", 3600], ["minute", 60]];
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) return `Edited ${relativeTime.format(Math.round(seconds / size), unit)}`;
  }
  return "Edited just now";
}

function RecentProject({ project, busy, onOpen, onRemove }: {
  project: ProjectSummary;
  busy: boolean;
  onOpen(): void;
  onRemove(): void;
}) {
  const [confirming, setConfirming] = useState(false);
  const portrait = project.height > project.width;
  return (
    <li className="recent-item">
      <button type="button" className="recent-card" disabled={busy} onClick={onOpen}>
        <span className={`recent-thumb ${portrait ? "portrait" : "landscape"}`}>
          {project.thumbnail
            ? <img src={`${window.captionForge.mediaUrl(project.thumbnail)}&v=${project.updatedAt}`} alt="" draggable={false} />
            : <SparkIcon size={18} />}
        </span>
        <span className="recent-info">
          <strong title={project.name}>{project.name}</strong>
          <span>
            {project.cueCount ? `${project.cueCount} caption${project.cueCount === 1 ? "" : "s"}` : "Not transcribed"}
            {" · "}{formatDuration(project.duration)}
            {" · "}{project.width}×{project.height}
          </span>
          <small>{formatEdited(project.updatedAt)}</small>
        </span>
      </button>
      {confirming ? (
        <span className="recent-confirm">
          <span>{project.filePath ? "Remove from recents?" : "Delete this unsaved project?"}</span>
          <button type="button" className="danger" onClick={onRemove}>Remove</button>
          <button type="button" onClick={() => setConfirming(false)}>Keep</button>
        </span>
      ) : (
        <button type="button" className="recent-remove" aria-label={`Remove ${project.name} from recent projects`} title="Remove from recents" onClick={() => setConfirming(true)}>×</button>
      )}
    </li>
  );
}

export default function Home({ recents, busy, onNewProject, onOpenFile, onOpenRecent, onRemove, children }: HomeProps) {
  const intro = (
    <>
      <div className="eyebrow"><span className="status-dot" /> Local-first video captions</div>
      <h1>Make every word<br /><span>land.</span></h1>
      <p>Transcribe, style, and render scroll-stopping subtitles using your own machine. Your footage never leaves your computer.</p>
      <div className="home-actions">
        <button className="primary large" disabled={busy} onClick={onNewProject}><FolderIcon /> New project from video</button>
        <button className="text-button" disabled={busy} onClick={onOpenFile}><FileIcon /> Open project file…</button>
      </div>
      <div className="feature-row">
        <span><SparkIcon /> Local Whisper</span>
        <span>25× native export</span>
        <span>100% offline</span>
      </div>
    </>
  );

  if (!recents?.length) {
    return (
      <main className="welcome-shell">
        <div className="window-drag" />
        <div className="brand brand-large"><span className="brand-mark">C</span><span>CaptionForge</span></div>
        <section className="welcome-card">{intro}</section>
        <div className="welcome-art" aria-hidden>
          <div className="portrait-frame">
            <div className="fake-video">
              <span className="grain" />
              <div className="fake-person" />
              <div className="fake-caption">MAKE EVERY <strong>WORD</strong> LAND.</div>
            </div>
          </div>
        </div>
        {children}
      </main>
    );
  }

  return (
    <main className="welcome-shell home-shell">
      <div className="window-drag" />
      <div className="brand brand-large"><span className="brand-mark">C</span><span>CaptionForge</span></div>
      <section className="welcome-card home-intro">{intro}</section>
      <section className="recent-panel" aria-labelledby="recent-heading">
        <div className="recent-heading">
          <h2 id="recent-heading">Recent projects</h2>
          <span>{recents.length}</span>
        </div>
        <ul className="recent-list">
          {recents.map((project) => (
            <RecentProject
              key={project.id}
              project={project}
              busy={busy}
              onOpen={() => onOpenRecent(project.id)}
              onRemove={() => onRemove(project.id)}
            />
          ))}
        </ul>
      </section>
      {children}
    </main>
  );
}
