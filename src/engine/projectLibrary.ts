// ---------------------------------------------------------------------------
// Project library — multi-save support
// ---------------------------------------------------------------------------
// The auto-save flow (App.tsx) writes the *current* project to the key
// `project:current` and overwrites it on every change. That's perfect for
// crash recovery but it gives users zero way to keep a finished short while
// starting a new one.
//
// This module layers a "library" on top of the existing IDB store so users
// can:
//   - Save the current project as a named snapshot
//   - Browse all saved snapshots (most recent first)
//   - Load any snapshot back into the live editor
//   - Rename / delete snapshots
//
// Storage layout (reuses the `kv` store from `storage.ts`):
//   - `lib:index`            → ProjectListEntry[]   (metadata only, cheap to load)
//   - `lib:project:<id>`     → ProjectState          (the actual project payload)
//
// We split metadata from payload so the library dialog renders fast even
// when a user has 50+ saved projects. Each entry weighs in at <1 KB versus
// the full project which can be several MB once images & audio are inlined.
// ---------------------------------------------------------------------------

import { v4 as uuid } from 'uuid';
import type { ProjectState } from '../types';
import { idbGet, idbSet, idbDelete } from './storage';

const INDEX_KEY = 'lib:index';
const projectKey = (id: string) => `lib:project:${id}`;

export interface ProjectListEntry {
  id: string;
  /** User-supplied display name, e.g. "Morning routine #3". */
  name: string;
  /** ms since epoch — when the snapshot was first taken. */
  createdAt: number;
  /** ms since epoch — last manual save (rename also bumps this). */
  updatedAt: number;
  /** Optional cover thumbnail (data URL of first clip). */
  thumbnail?: string;
  /** Pre-computed totals used by the library list. */
  clipCount: number;
  durationSec: number;
  /** Tagged when the project originated from a built-in template. */
  templateId?: string;
}

/** Load the lightweight project index. Returns [] if nothing saved yet. */
export async function listProjects(): Promise<ProjectListEntry[]> {
  const list = await idbGet<ProjectListEntry[]>(INDEX_KEY);
  return Array.isArray(list) ? list : [];
}

/** Load a specific saved project by id. Null if it was deleted. */
export async function loadProject(id: string): Promise<ProjectState | null> {
  const p = await idbGet<ProjectState>(projectKey(id));
  return p ?? null;
}

/**
 * Save the current project as a *new* library entry. Always creates a fresh
 * id so calling this twice in a row produces two snapshots — never an
 * overwrite (that's what `updateProject` is for).
 *
 * @param name   Display name shown in the library.
 * @param state  The full ProjectState to snapshot.
 * @returns The new entry's metadata.
 */
export async function saveAsNew(
  name: string,
  state: ProjectState,
  templateId?: string
): Promise<ProjectListEntry> {
  const now = Date.now();
  const id = uuid();
  const entry: ProjectListEntry = {
    id,
    name: name.trim() || `Untitled ${new Date(now).toLocaleString()}`,
    createdAt: now,
    updatedAt: now,
    thumbnail: pickThumbnail(state),
    clipCount: state.clips.length,
    durationSec: state.clips.reduce((sum, c) => sum + (c.duration || 0), 0),
    templateId
  };
  await idbSet(projectKey(id), sanitizeForStorage(state));
  const list = await listProjects();
  await idbSet(INDEX_KEY, [entry, ...list]);
  return entry;
}

/**
 * Overwrite an existing library entry with a fresh snapshot. Updates the
 * metadata (timestamp, thumbnail, totals) too.
 */
export async function updateProject(
  id: string,
  state: ProjectState
): Promise<ProjectListEntry | null> {
  const list = await listProjects();
  const idx = list.findIndex((e) => e.id === id);
  if (idx === -1) return null;
  const now = Date.now();
  const updated: ProjectListEntry = {
    ...list[idx],
    updatedAt: now,
    thumbnail: pickThumbnail(state),
    clipCount: state.clips.length,
    durationSec: state.clips.reduce((sum, c) => sum + (c.duration || 0), 0)
  };
  await idbSet(projectKey(id), sanitizeForStorage(state));
  const next = list.slice();
  next.splice(idx, 1);
  next.unshift(updated); // bump to top
  await idbSet(INDEX_KEY, next);
  return updated;
}

/** Update just the display name. */
export async function renameProject(
  id: string,
  newName: string
): Promise<ProjectListEntry | null> {
  const list = await listProjects();
  const idx = list.findIndex((e) => e.id === id);
  if (idx === -1) return null;
  const updated: ProjectListEntry = {
    ...list[idx],
    name: newName.trim() || list[idx].name,
    updatedAt: Date.now()
  };
  const next = list.slice();
  next[idx] = updated;
  await idbSet(INDEX_KEY, next);
  return updated;
}

/** Delete a saved project (metadata + payload). */
export async function deleteProject(id: string): Promise<void> {
  const list = await listProjects();
  const next = list.filter((e) => e.id !== id);
  await idbSet(INDEX_KEY, next);
  await idbDelete(projectKey(id));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strip any `blob:` URLs before persisting — they don't survive a reload
 * and would render as broken images on next load.
 */
function sanitizeForStorage(state: ProjectState): ProjectState {
  return {
    ...state,
    clips: state.clips.map((c) => ({
      ...c,
      src: c.src?.startsWith('blob:') ? '' : c.src,
      splitSrc: c.splitSrc?.startsWith('blob:') ? '' : c.splitSrc
    })),
    audio: {
      ...state.audio,
      src: state.audio.src?.startsWith('blob:') ? null : state.audio.src
    },
    audio2: {
      ...state.audio2,
      src: state.audio2.src?.startsWith('blob:') ? null : state.audio2.src
    }
  };
}

/**
 * Pick a representative thumbnail from the project. Uses the first clip's
 * src — works for AI-generated, uploaded, and dataURL images. Skips empty
 * sources (e.g. after a blob: URL was stripped).
 */
function pickThumbnail(state: ProjectState): string | undefined {
  for (const c of state.clips) {
    if (c.src && !c.src.startsWith('blob:')) return c.src;
  }
  return undefined;
}
