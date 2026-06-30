/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ADMIN_EMAIL?: string;
  readonly VITE_LOCAL_ADMIN_KEY?: string;
  readonly VITE_USE_VERCEL_API?: string;
  readonly VITE_WALKTHROUGH_VIDEO_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module 'fix-webm-duration' {
  /**
   * Patches a WebM Blob produced by MediaRecorder so that it contains a
   * proper Duration element (MediaRecorder writes "unknown" segment size
   * which makes most desktop players show 0s / refuse to play).
   * @param blob       The recorded WebM Blob.
   * @param durationMs Recording duration in milliseconds.
   * @param options    Optional config; `logger: false` disables console output.
   */
  export default function fixWebmDuration(
    blob: Blob,
    durationMs: number,
    options?: { logger?: false | ((msg: string) => void) }
  ): Promise<Blob>;
}
