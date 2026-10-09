import type { AppState, CaptionProject, ExportSettings, JobProgress, ProjectSummary, TranscriptionResult, VideoInfo, WhisperModelStatus } from "./types";

declare global {
  interface Window {
    captionForge: {
      openVideo(): Promise<VideoInfo | null>;
      openProject(): Promise<{ data: unknown; filePath: string; modifiedAt: number } | null>;
      listProjects(): Promise<ProjectSummary[]>;
      createProject(project: CaptionProject): Promise<string>;
      saveLibraryProject(id: string, project: CaptionProject, filePath?: string | null): Promise<void>;
      openLibraryProject(id: string): Promise<{ id: string; filePath: string | null; project: unknown; videoMissing: boolean }>;
      importProject(project: CaptionProject, filePath: string, modifiedAt: number): Promise<string>;
      removeProject(id: string): Promise<void>;
      relinkProject(id: string): Promise<{ summary: ProjectSummary; previousDuration: number } | null>;
      mediaExists(filePath: string): Promise<boolean>;
      saveProject(project: CaptionProject, currentPath: string | null, saveAs: boolean): Promise<string | null>;
      createPreview?(filePath: string): Promise<string>;
      listFonts?(): Promise<string[]>;
      listModels(): Promise<WhisperModelStatus[]>;
      loadState(legacyState: AppState): Promise<AppState>;
      saveState(state: AppState): Promise<AppState>;
      transcribe(options: {
        videoPath: string;
        model: string;
        language: string;
        wordsPerCue: number;
      }): Promise<TranscriptionResult>;
      exportVideo(project: CaptionProject, settings: ExportSettings): Promise<string | null>;
      cancelJob(): Promise<boolean>;
      mediaUrl(filePath: string): string;
      onProgress(callback: (progress: JobProgress) => void): () => void;
    };
  }
}

export {};
