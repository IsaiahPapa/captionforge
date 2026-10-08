export type Transition = "none" | "pop" | "fade";
export type CaptionPosition = "top" | "center" | "bottom";

export interface VideoInfo {
  path: string;
  name: string;
  width: number;
  height: number;
  duration: number;
  fps: number;
  size: number;
}

export interface CaptionWord {
  id: string;
  text: string;
  start: number;
  end: number;
  confidence?: number;
}

export interface CaptionCue {
  id: string;
  start: number;
  end: number;
  text: string;
  words: CaptionWord[];
}

export interface CaptionStyle {
  id: string;
  name: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  fontStyle: "normal" | "italic";
  letterSpacing: number;
  primaryColor: string;
  activeColor: string;
  outlineColor: string;
  outlineWidth: number;
  shadow: number;
  position: CaptionPosition;
  marginPercent: number;
  verticalOffsetPercent: number;
  uppercase: boolean;
  highlightActiveWord: boolean;
  transition: Transition;
  wordTimingOffsetMs?: number;
}

export interface CaptionProject {
  version: 1;
  video: VideoInfo;
  language: string;
  cues: CaptionCue[];
  style: CaptionStyle;
}

export interface ExportSettings {
  resolution: "source" | "1080" | "720";
  quality: "draft" | "balanced" | "high";
  codec: "h264" | "hevc";
  frameRate: "source" | "24" | "30" | "60";
  hardwareAcceleration: boolean;
  audioBitrate: 128 | 192 | 320;
}

export interface AppState {
  version: 1;
  project: CaptionProject | null;
  userStylePresets: CaptionStyle[];
  exportSettings: ExportSettings | null;
}

export interface JobProgress {
  stage: "model" | "audio" | "transcribing" | "export" | "complete";
  value: number;
  message: string;
}

export interface WhisperModelStatus {
  id: string;
  size: number;
  installed: boolean;
}

export interface TranscriptionResult {
  language: string;
  cues: CaptionCue[];
}
