import type { ExportSettings } from "./types";

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  resolution: "source",
  quality: "balanced",
  codec: "h264",
  frameRate: "source",
  hardwareAcceleration: true,
  audioBitrate: 192
};
