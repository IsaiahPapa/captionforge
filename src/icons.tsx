import type { ReactNode } from "react";

const Icon = ({ children, size = 18 }: { children: ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);

export const PlayIcon = () => <Icon><polygon points="7 4 20 12 7 20 7 4" /></Icon>;
export const PauseIcon = () => <Icon><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></Icon>;
export const FolderIcon = () => <Icon><path d="M3 6.5h6l2 2h10v9.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /><path d="M3 9h18" /></Icon>;
export const SparkIcon = ({ size }: { size?: number }) => <Icon size={size}><path d="m12 3 1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5Z" /><path d="m19 15 .7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7Z" /></Icon>;
export const ExportIcon = () => <Icon><path d="M12 15V3" /><path d="m7 8 5-5 5 5" /><path d="M5 13v7h14v-7" /></Icon>;

export const BackIcon = () => <Icon size={16}><path d="m15 18-6-6 6-6" /></Icon>;
export const PlusIcon = () => <Icon><path d="M12 5v14M5 12h14" /></Icon>;
export const FileIcon = () => <Icon><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" /><path d="M14 3v6h6" /></Icon>;
