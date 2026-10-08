import type { AppState, CaptionProject, ExportSettings, JobProgress, TranscriptionResult, VideoInfo, WhisperModelStatus } from "./types";

declare global {
  interface Window {
    captionForge: {
      openVideo(): Promise<VideoInfo | null>;
      openProject(): Promise<CaptionProject | null>;
      saveProject(project: CaptionProject): Promise<string | null>;
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
