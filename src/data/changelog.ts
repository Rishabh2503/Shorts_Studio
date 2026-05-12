/**
 * Changelog feed for the in-app notifications bell.
 *
 * Entries are listed newest-first. Bump the `latestSeenId` key in
 * localStorage by storing the most recent `id` the user has acknowledged
 * (handled inside NotificationsMenu) so the unread badge counts only
 * entries the user hasn't opened yet.
 *
 * To ship a new rollout, prepend a new entry here \u2014 the bell will
 * automatically light up for everyone on their next visit.
 */
export type ChangelogKind = 'feature' | 'improvement' | 'fix';

export interface ChangelogEntry {
  /** Stable identifier. Never reuse \u2014 unread-tracking relies on it. */
  id: string;
  /** Human date, shown as a subtitle. */
  date: string;
  /** Headline shown in the menu. */
  title: string;
  /** Short body. Keep to ~2 sentences so the menu stays scannable. */
  body: string;
  /** Coloured chip / icon hint. */
  kind: ChangelogKind;
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    id: '2026-05-12-seo-pwa',
    date: 'May 12, 2026',
    title: 'Installable app, social previews & faster loads',
    body:
      'Shorts Studio is now installable to your home screen, has a polished brand favicon, and ships with rich search-engine + social-card metadata. Initial page loads are also lighter thanks to code-splitting.',
    kind: 'improvement'
  },
  {
    id: '2026-05-12-autosave',
    date: 'May 12, 2026',
    title: 'Autosave \u2014 your project survives a refresh',
    body:
      'Every edit is now saved to your browser locally. Accidental refresh? Browser crash? Closed the tab? Your timeline, captions, and settings come back exactly how you left them.',
    kind: 'feature'
  },
  {
    id: '2026-05-12-help-bell',
    date: 'May 12, 2026',
    title: 'Notifications bell + user guide',
    body:
      'A new bell icon highlights fresh rollouts, and a "?" icon next to it opens a full user guide with examples for every feature \u2014 perfect for first-time visitors.',
    kind: 'feature'
  },
  {
    id: '2026-05-12-ui-polish',
    date: 'May 12, 2026',
    title: 'Polished UI: animated render CTA + mobile control bar',
    body:
      'The Render & download button now sits right under the preview with a shimmering gradient. On phones, aspect ratio + captions move into a dedicated bar above the preview so the header never feels cramped.',
    kind: 'improvement'
  },
  {
    id: '2026-05-12-aspect-ratios',
    date: 'May 12, 2026',
    title: '5 aspect ratios \u2014 Shorts, landscape, square, portrait, classic',
    body:
      'Pick 9:16, 16:9, 1:1, 4:5, or 4:3 from the pill in the header. Canvas, preview, and exported WebM all switch resolution instantly.',
    kind: 'feature'
  },
  {
    id: '2026-05-12-split-screen',
    date: 'May 12, 2026',
    title: 'Split-screen clips (horizontal or vertical)',
    body:
      'Each clip can now show two images at once. Upload a second image or AI-generate it directly from the clip settings.',
    kind: 'feature'
  },
  {
    id: '2026-05-12-dual-audio',
    date: 'May 12, 2026',
    title: 'Background music track (copyright-safe layering)',
    body:
      'Add a second audio file that plays in parallel with your voiceover. Captions still come only from the main transcript.',
    kind: 'feature'
  },
  {
    id: '2026-05-10-whisper',
    date: 'May 10, 2026',
    title: 'On-device Whisper transcription',
    body:
      'Auto-generate word-level captions from any uploaded audio. Runs locally in the browser \u2014 nothing leaves your device.',
    kind: 'feature'
  },
  {
    id: '2026-05-08-ai-cascade',
    date: 'May 8, 2026',
    title: 'AI image cascade: Pollinations \u2192 Flickr \u2192 Picsum',
    body:
      'When one provider rate-limits or fails, the generator falls back automatically so you always get an image.',
    kind: 'improvement'
  }
];
