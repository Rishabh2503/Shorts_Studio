import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Container,
  FormControlLabel,
  IconButton,
  Paper,
  Slider,
  Stack,
  Switch,
  Tooltip,
  Typography
} from '@mui/material';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import PauseRoundedIcon from '@mui/icons-material/PauseRounded';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import RepeatIcon from '@mui/icons-material/Repeat';
import RepeatOnIcon from '@mui/icons-material/RepeatOn';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import SubtitlesIcon from '@mui/icons-material/Subtitles';
import { v4 as uuid } from 'uuid';
import { DEFAULT_PROJECT, type ImageClip, type ProjectState } from './types';
import { totalDuration } from './engine/render';
import { newEffectSeed } from './engine/effectPicker';
import { newCaptionSeed } from './engine/captionAi';
import { analyzeAudio, invalidateAudioAnalysis } from './engine/audioAnalyzer';
import { transcribeAudio, clearWhisperCache, type STTProgress } from './engine/speechToText';
import { filterFillerWords, buildCues, cuesToSRT } from './engine/captionText';
import { PreviewCanvas } from './components/PreviewCanvas';
import { MediaPanel } from './components/MediaPanel';
import { Timeline } from './components/Timeline';
import { AudioPanel } from './components/AudioPanel';
import { ScriptPanel } from './components/ScriptPanel';
import { TranscriptEditorDialog } from './components/TranscriptEditorDialog';
import { ExportButton } from './components/ExportButton';
import { DropZone } from './components/DropZone';
import { ToastProvider, useToast } from './components/Toast';
import { pruneCache } from './engine/imageCache';

export default function App() {
  return (
    <ToastProvider>
      <AppInner />
    </ToastProvider>
  );
}

function AppInner() {
  const toast = useToast();
  const [project, setProject] = useState<ProjectState>(DEFAULT_PROJECT);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  /**
   * Audio peak timestamps for the current track (offset relative to the
   * audio file's t=0). Recomputed when audio.src changes; used by the
   * project-script renderer for speech-rhythm word alignment.
   */
  const [audioPeaks, setAudioPeaks] = useState<number[] | null>(null);
  /**
   * Speech-to-text in-progress flag and latest progress event. The button
   * lives in ScriptPanel but the actual transcription is owned here so the
   * resulting script + word timestamps update the project state directly.
   */
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeProgress, setTranscribeProgress] = useState<STTProgress | null>(null);
  /**
   * Last transcription error message — surfaced inline in ScriptPanel with
   * a "Clear cache & retry" button when the error looks like a corrupt
   * cached model shard.
   */
  const [transcribeError, setTranscribeError] = useState<string | null>(null);
  /**
   * Whether playback should loop back to the start when reaching `dur`.
   * Default OFF — most users expect a Shorts-style preview to play once and
   * stop, so they can hit "Restart" to play it again. Enable from the
   * transport's loop toggle.
   */
  const [loopVideo, setLoopVideo] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(0);
  // Refs avoid re-creating the rAF loop every time `dur` changes — the loop
  // reads the live duration without listing it as a dep.
  const durRef = useRef(0);
  const loopRef = useRef(false);
  loopRef.current = loopVideo;

  const videoDur = useMemo(() => totalDuration(project.clips), [project.clips]);
  const audioRangeDur = useMemo(() => {
    const { start, end, duration, src } = project.audio;
    if (!src) return 0;
    const e = end ?? duration ?? 0;
    return Math.max(0, e - start);
  }, [project.audio]);

  /**
   * Effective playback duration. Driven by the chosen syncMode:
   *   - 'fitVideo'  : video stretches — duration = audio range (so audio
   *                   plays in full and video clips share the time evenly).
   *   - 'fitAudio'  : video stays — duration = sum of clip durations, audio
   *                   trim is applied as-is (extra audio clipped, short audio
   *                   does not loop).
   *   - 'loop'      : video drives length; audio loops to fill (legacy).
   */
  const dur = useMemo(() => {
    const mode = project.audio.syncMode;
    if (mode === 'fitVideo' && audioRangeDur > 0) return audioRangeDur;
    return videoDur;
  }, [videoDur, audioRangeDur, project.audio.syncMode]);
  durRef.current = dur;

  // rAF playback loop. Two important behaviors here:
  //   1. Only schedules itself while `playing` is true. When paused we tear
  //      it down completely so React isn't getting setState calls 60×/s for
  //      no reason (this was triggering "Maximum update depth exceeded"
  //      under StrictMode).
  //   2. Throttles state updates to ~30 fps (matches export fps and is plenty
  //      smooth for preview). Also bails the setState when the new value is
  //      effectively unchanged so React can skip a re-render.
  useEffect(() => {
    if (!playing) {
      lastTickRef.current = 0;
      return;
    }
    let alive = true;
    const TICK_INTERVAL = 1000 / 30; // 33ms — 30fps preview
    let lastUpdate = 0;
    /**
     * Set when the playhead has reached the end and we need to stop. We can't
     * call `setPlaying(false)` from inside `setTime`'s updater (it nests state
     * updates), so we flag it here and handle it once outside the updater.
     */
    let reachedEnd = false;
    const tick = (now: number) => {
      if (!alive) return;
      const last = lastTickRef.current || now;
      const dt = Math.min(0.25, (now - last) / 1000); // clamp big gaps (tab hidden etc.)
      // Throttle: only push state every TICK_INTERVAL ms.
      if (now - lastUpdate >= TICK_INTERVAL) {
        lastTickRef.current = now;
        lastUpdate = now;
        const d = durRef.current;
        const loop = loopRef.current;
        setTime((t) => {
          if (d <= 0) return 0;
          let nt = t + dt;
          if (nt >= d) {
            if (loop) {
              nt = nt % d; // wrap, don't reset to 0 abruptly
            } else {
              // Pin to the very end and signal the outer effect to pause.
              nt = d;
              reachedEnd = true;
            }
          }
          // No-op if essentially unchanged (avoids needless render).
          if (Math.abs(nt - t) < 0.0005) return t;
          return nt;
        });
        if (reachedEnd) {
          reachedEnd = false;
          setPlaying(false);
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      alive = false;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastTickRef.current = 0;
    };
  }, [playing]);

  // Audio playback control mirrors the `playing` state — completely decoupled
  // from the render loop so it doesn't cause re-renders. Honours the audio
  // trim window: preview starts at audio.start and (in fitAudio mode) stops
  // at audio.end so the user only hears the chosen slice.
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    if (playing && dur > 0) {
      lastTickRef.current = 0; // reset dt accumulator so first frame after play has dt=0
      a.volume = project.audio.volume;
      // Translate playhead into audio-file time, accounting for trim start.
      const audioT = project.audio.start + Math.min(time, audioRangeDur || dur);
      try { a.currentTime = audioT; } catch { /* ignore seek errors */ }
      a.play().catch(() => {
        /* autoplay may be blocked; ignore */
      });
    } else {
      a.pause();
    }
    // We *don't* depend on `time` here — we don't want to re-seek every frame,
    // only on play / pause / sync-mode changes. Manual scrub uses a separate
    // effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, dur, project.audio.volume, project.audio.src, project.audio.start, project.audio.syncMode]);

  // Hard-stop the audio when its trim end is reached (fitAudio / fitVideo).
  // Without this, the <audio loop> attribute would replay past audio.end.
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => {
      const end = project.audio.end ?? project.audio.duration ?? Infinity;
      if (a.currentTime >= end - 0.02) {
        if (project.audio.syncMode === 'loop') {
          // Wrap to start of trim range, not file start.
          a.currentTime = project.audio.start;
        } else {
          a.pause();
          a.currentTime = project.audio.start;
        }
      }
    };
    a.addEventListener('timeupdate', onTime);
    return () => a.removeEventListener('timeupdate', onTime);
  }, [project.audio.end, project.audio.duration, project.audio.start, project.audio.syncMode]);

  // Auto-stop and clamp when the project becomes empty.
  useEffect(() => {
    if (dur <= 0) {
      if (playing) setPlaying(false);
      if (time !== 0) setTime(0);
    } else if (time > dur) {
      setTime(0);
    }
    // Intentionally only react to dur changes — `time` and `playing` updates
    // are handled inside the rAF and onClick handlers respectively.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dur]);

  const addImage = useCallback(
    (src: string, prompt?: string) => {
      const clip: ImageClip = {
        id: uuid(),
        src,
        duration: 3,
        // Default to AI-picked effect so each clip gets motion that fits its
        // prompt — and varies across clips because of the unique effectSeed.
        effect: 'auto',
        effectSeed: newEffectSeed(),
        transition: 'fade',
        // Same idea for captions: 'auto' lets the AI pick a fitting style,
        // and the seed makes that pick deterministic-but-varied per clip.
        captionAnim: 'auto',
        captionStyleSeed: newCaptionSeed(),
        prompt
      };
      setProject((p) => ({ ...p, clips: [...p.clips, clip] }));
      setSelectedId(clip.id);
      toast.show('Clip added to timeline', 'success');
    },
    [toast]
  );

  // Drag-and-drop audio handler with type validation.
  const handleAudioDrop = useCallback(
    (dataUrl: string, name: string) => {
      // Reset trim & duration; will be filled in by the analyzer effect.
      invalidateAudioAnalysis(dataUrl);
      setProject((p) => ({
        ...p,
        audio: {
          ...p.audio,
          src: dataUrl,
          name,
          start: 0,
          end: null,
          duration: null
        }
      }));
      toast.show(`Audio loaded: ${name}`, 'success');
    },
    [toast]
  );

  // Decode + analyze the audio whenever it changes. Updates the trim end +
  // duration metadata once the analyzer reports back, and feeds the peak
  // list to the project-script renderer for speech-rhythm word alignment.
  useEffect(() => {
    const src = project.audio.src;
    if (!src) {
      setAudioPeaks(null);
      return;
    }
    let alive = true;
    analyzeAudio(src)
      .then((info) => {
        if (!alive) return;
        setAudioPeaks(info.peaks);
        setProject((p) => {
          if (p.audio.src !== src) return p;
          // Don't overwrite a user-set trim. Only fill in `duration` and
          // default `end` to the file end on first load.
          const next = { ...p.audio, duration: info.duration };
          if (next.end == null) next.end = info.duration;
          return { ...p, audio: next };
        });
      })
      .catch((e) => {
        if (!alive) return;
        toast.show(`Audio analysis failed: ${(e as Error).message}`, 'warning');
      });
    return () => {
      alive = false;
    };
    // We depend only on the src (URL); other audio fields shouldn't retrigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.audio.src]);

  // Drop the cache for sources that are no longer in use to keep memory bounded.
  useEffect(() => {
    pruneCache(project.clips.map((c) => c.src));
  }, [project.clips]);

  // Listen for global runtime errors so we can surface a toast instead of crashing silently.
  useEffect(() => {
    const onErr = (ev: ErrorEvent) => {
      toast.show(`Error: ${ev.message}`, 'error');
    };
    const onRej = (ev: PromiseRejectionEvent) => {
      const msg =
        (ev.reason && (ev.reason.message || String(ev.reason))) || 'Unknown error';
      toast.show(`Error: ${msg}`, 'error');
    };
    window.addEventListener('error', onErr);
    window.addEventListener('unhandledrejection', onRej);
    return () => {
      window.removeEventListener('error', onErr);
      window.removeEventListener('unhandledrejection', onRej);
    };
  }, [toast]);

  function updateClip(id: string, patch: Partial<ImageClip>) {
    setProject((p) => ({
      ...p,
      clips: p.clips.map((c) => (c.id === id ? { ...c, ...patch } : c))
    }));
  }

  /**
   * Seek the playhead and re-sync the audio element so the trim window is
   * respected. Called by the restart button and the scrub slider.
   */
  function seekTo(t: number) {
    const clamped = Math.max(0, Math.min(dur, t));
    setTime(clamped);
    const a = audioRef.current;
    if (a) {
      try {
        a.currentTime = project.audio.start + clamped;
      } catch {
        /* some browsers throw on cross-origin seeking; ignore */
      }
    }
  }

  /**
   * Run Whisper on the loaded audio and populate the script with the
   * transcribed text + per-word timestamps. Word times are stored relative
   * to *project* time (i.e. with `audio.start` already subtracted) so the
   * renderer can use them directly. Words that fall outside the trim window
   * are dropped.
   */
  const handleTranscribe = useCallback(async () => {
    const src = project.audio.src;
    if (!src) {
      toast.show('Load audio before transcribing.', 'warning');
      return;
    }
    setTranscribing(true);
    setTranscribeError(null);
    setTranscribeProgress({ stage: 'load-model' });
    try {
      // Only transcribe the trimmed range — saves a lot of time on long
      // files and stops Whisper from picking up speech the user cut.
      const trimStart = project.audio.start;
      const trimEnd = project.audio.end ?? project.audio.duration ?? undefined;
      // Throttle progress updates to ~10fps. Without this, transformers.js
      // fires hundreds of `progress` events per second during chunked
      // download + token-level inference, which causes React's "Maximum
      // update depth exceeded" warning under StrictMode and pegs the main
      // thread re-rendering.
      let lastProgressUpdate = 0;
      let lastStage: string | undefined;
      const result = await transcribeAudio(src, {
        trim: { start: trimStart, end: trimEnd ?? undefined },
        model: project.script.sttModel ?? 'en',
        language: project.script.sttLanguage ?? 'auto',
        onProgress: (p) => {
          const now = performance.now();
          // Always push when the stage changes or when 100ms have passed
          // since the last UI update. This keeps the bar smooth without
          // flooding React with re-renders.
          if (p.stage !== lastStage || now - lastProgressUpdate >= 100) {
            lastStage = p.stage;
            lastProgressUpdate = now;
            setTranscribeProgress(p);
          }
        }
      });
      // Map words into project time. Drop anything outside the trim window.
      const startCut = project.audio.start;
      const endCut = project.audio.end ?? Infinity;
      const kept = result.words.filter(
        (w) => w.start >= startCut - 0.05 && w.start < endCut + 0.05
      );
      const text = kept.map((w) => w.word).join(' ').trim();
      const wordTimes = kept.map((w) => Math.max(0, w.start - startCut));
      const wordEnds = kept.map((w) => Math.max(0, w.end - startCut));
      if (kept.length === 0) {
        toast.show('No speech detected in the trim window.', 'warning');
      } else {
        toast.show(`Transcribed ${kept.length} words.`, 'success');
      }
      setProject((p) => ({
        ...p,
        captionsEnabled: p.captionsEnabled || kept.length > 0,
        // Stretch video to audio so words don't race ahead of speech.
        audio:
          kept.length > 0 && p.audio.syncMode !== 'fitVideo'
            ? { ...p.audio, syncMode: 'fitVideo' }
            : p.audio,
        script: {
          ...p.script,
          text,
          wordTimes,
          wordEnds,
          syncMode: kept.length > 0 ? 'transcript' : p.script.syncMode
        }
      }));
    } catch (e) {
      const msg = (e as Error).message || 'Unknown error';
      setTranscribeError(msg);
      toast.show(`Transcription failed: ${msg}`, 'error');
    } finally {
      setTranscribing(false);
      setTranscribeProgress(null);
    }
  }, [
    project.audio.src,
    project.audio.start,
    project.audio.end,
    project.script.sttModel,
    project.script.sttLanguage,
    toast
  ]);

  /**
   * Option B — user has pasted their own script and wants captions to follow
   * the audio. We:
   *   1. Switch audio sync to 'fitVideo' so the *video* duration becomes the
   *      audio length. Without this step, a long script over a short video
   *      would scroll captions much faster than the audio plays.
   *   2. Switch script sync to 'audio' (peak-aligned reveals).
   *   3. Drop any stale STT word timestamps so the renderer falls back to
   *      peak distribution.
   */
  const handleSyncPastedScript = useCallback(() => {
    if (!project.audio.src) {
      toast.show('Load audio first.', 'warning');
      return;
    }
    if (!project.script.text.trim()) {
      toast.show('Paste a script first.', 'warning');
      return;
    }
    setProject((p) => ({
      ...p,
      captionsEnabled: true,
      audio: { ...p.audio, syncMode: 'fitVideo' },
      script: {
        ...p.script,
        wordTimes: undefined,
        wordEnds: undefined,
        syncMode: 'audio'
      }
    }));
    toast.show(
      'Synced. Video stretched to audio length so captions match speech.',
      'success'
    );
  }, [project.audio.src, project.script.text, toast]);

  /**
   * Drop the cached Whisper model + retry transcription. Used when a
   * previous load left a corrupt q4 shard in the browser cache.
   */
  const handleClearCache = useCallback(async () => {
    try {
      await clearWhisperCache();
      toast.show('Speech model cache cleared. Retrying…', 'info');
      setTranscribeError(null);
      // Kick off a fresh transcription so the user doesn't have to click again.
      void handleTranscribe();
    } catch (e) {
      toast.show(`Cache clear failed: ${(e as Error).message}`, 'error');
    }
  }, [toast, handleTranscribe]);

  /**
   * Open / close the per-word transcript editor dialog.
   */
  const [transcriptEditorOpen, setTranscriptEditorOpen] = useState(false);

  /**
   * Download a .srt sidecar of the current script + word timings. Useful for
   * users who toggle off "Burn-in" and need a separate captions file for
   * platforms like YouTube that accept SRT uploads.
   */
  const handleDownloadSRT = useCallback(() => {
    const text = project.script.text.trim();
    if (!text) {
      toast.show('No script to export.', 'warning');
      return;
    }
    // Use filtered words so the SRT matches what's burned on the video.
    const filtered = filterFillerWords(
      text,
      project.script.wordTimes,
      project.script.wordEnds,
      !!project.script.filterFillers,
      project.script.customFillers ?? []
    );
    const cues = buildCues(
      filtered.words,
      filtered.wordTimes,
      filtered.wordEnds,
      Math.max(1, totalDuration(project.clips))
    );
    const srt = cuesToSRT(cues);
    const blob = new Blob([srt], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'captions.srt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.show(`Saved captions.srt (${cues.length} cues)`, 'success');
  }, [
    project.script.text,
    project.script.wordTimes,
    project.script.wordEnds,
    project.script.filterFillers,
    project.script.customFillers,
    project.clips,
    toast
  ]);

  function removeClip(id: string) {
    setProject((p) => ({ ...p, clips: p.clips.filter((c) => c.id !== id) }));
    if (selectedId === id) setSelectedId(null);
  }

  function moveClip(id: string, dir: -1 | 1) {
    setProject((p) => {
      const i = p.clips.findIndex((c) => c.id === id);
      if (i < 0) return p;
      const j = i + dir;
      if (j < 0 || j >= p.clips.length) return p;
      const arr = [...p.clips];
      const [c] = arr.splice(i, 1);
      arr.splice(j, 0, c);
      return { ...p, clips: arr };
    });
  }

  function duplicateClip(id: string) {
    setProject((p) => {
      const i = p.clips.findIndex((c) => c.id === id);
      if (i < 0) return p;
      const copy: ImageClip = { ...p.clips[i], id: uuid() };
      const arr = [...p.clips];
      arr.splice(i + 1, 0, copy);
      return { ...p, clips: arr };
    });
  }

  // Jump playhead to the start of the selected clip when selection changes by user click.
  useEffect(() => {
    if (!selectedId) return;
    let acc = 0;
    for (const c of project.clips) {
      if (c.id === selectedId) {
        setTime(acc);
        return;
      }
      acc += c.duration;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const onLoadError = useCallback(
    (n: number) => {
      toast.show(
        `${n} image${n === 1 ? '' : 's'} failed to load. Try regenerating or replacing.`,
        'warning'
      );
    },
    [toast]
  );

  return (
    <Box className="aurora" sx={{ minHeight: '100vh' }}>
      <DropZone onImage={(url) => addImage(url)} onAudio={handleAudioDrop} />
      {/* Hidden audio element used during preview only. The exporter has its own. */}
      {project.audio.src && (
        <audio ref={audioRef} src={project.audio.src} preload="auto" />
      )}

      <Container maxWidth="xl" sx={{ py: 3 }}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          alignItems={{ xs: 'flex-start', md: 'center' }}
          justifyContent="space-between"
          spacing={2}
          mb={3}
        >
          <Stack direction="row" alignItems="center" spacing={1.5}>
            <Box
              sx={{
                width: 44,
                height: 44,
                borderRadius: 2,
                background:
                  'linear-gradient(135deg,#7c3aed 0%,#22d3ee 60%,#ff3ea5 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 8px 24px rgba(124,58,237,0.35)'
              }}
            >
              <AutoAwesomeIcon sx={{ color: '#fff' }} />
            </Box>
            <Box>
              <Typography variant="h4" sx={{ lineHeight: 1 }}>
                Shorts Studio
              </Typography>
              <Typography variant="caption" color="text.secondary">
                AI-powered YouTube Shorts maker • runs entirely in your browser
              </Typography>
            </Box>
          </Stack>
          <Stack direction="row" alignItems="center" spacing={2}>
            <Tooltip title="Toggles AI-styled, animated captions on top of every clip. Each clip's caption gets its own font, color, and animation chosen from the prompt.">
              <FormControlLabel
                control={
                  <Switch
                    color="secondary"
                    checked={project.captionsEnabled}
                    onChange={(_, v) =>
                      setProject((p) => ({ ...p, captionsEnabled: v }))
                    }
                  />
                }
                label={
                  <Stack direction="row" spacing={0.75} alignItems="center">
                    <SubtitlesIcon fontSize="small" />
                    <Typography variant="body2">Animated Captions</Typography>
                  </Stack>
                }
                sx={{ ml: 0, userSelect: 'none' }}
              />
            </Tooltip>
            <ExportButton project={project} />
          </Stack>
        </Stack>

        <Stack
          direction={{ xs: 'column', lg: 'row' }}
          spacing={2}
          alignItems="stretch"
        >
          {/* Left: Media + Audio */}
          <Stack spacing={2} sx={{ flex: '0 0 320px' }}>
            <Paper sx={{ p: 2 }}>
              <MediaPanel onAddImage={addImage} />
            </Paper>
            <Paper sx={{ p: 2 }}>
              <AudioPanel
                audio={project.audio}
                onChange={(audio) => setProject((p) => ({ ...p, audio }))}
                onRestart={() => seekTo(0)}
              />
            </Paper>
            <Paper sx={{ p: 2 }}>
              <ScriptPanel
                script={project.script}
                onChange={(script) => setProject((p) => ({ ...p, script }))}
                hasAudio={!!project.audio.src}
                hasPeaks={(audioPeaks?.length ?? 0) > 0}
                onTranscribe={handleTranscribe}
                onSyncPastedScript={handleSyncPastedScript}
                onClearCache={handleClearCache}
                transcribing={transcribing}
                transcribeProgress={transcribeProgress}
                transcribeError={transcribeError}
                onEditTranscript={() => setTranscriptEditorOpen(true)}
                onDownloadSRT={handleDownloadSRT}
              />
            </Paper>
          </Stack>

          {/* Center: Preview */}
          <Stack spacing={2} sx={{ flex: '1 1 auto', minWidth: 0 }}>
            <Paper
              sx={{
                p: 2,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 1.5
              }}
            >
              <Box
                sx={{
                  width: '100%',
                  maxWidth: 360,
                  aspectRatio: '9 / 16',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <PreviewCanvas
                  project={project}
                  time={time}
                  audioPeaks={audioPeaks}
                  onLoadError={onLoadError}
                />
              </Box>

              <Stack direction="row" alignItems="center" spacing={1} sx={{ width: '100%' }}>
                <IconButton
                  onClick={() => {
                    // If we paused at the end, pressing Play replays from 0.
                    if (!playing && time >= dur - 0.01 && dur > 0) {
                      seekTo(0);
                    }
                    setPlaying((p) => !p);
                  }}
                  disabled={dur <= 0}
                  size="large"
                  sx={{
                    background:
                      'linear-gradient(135deg,#7c3aed 0%,#22d3ee 100%)',
                    color: '#fff',
                    '&:hover': { opacity: 0.9 }
                  }}
                >
                  {playing ? <PauseRoundedIcon /> : <PlayArrowRoundedIcon />}
                </IconButton>
                <IconButton onClick={() => seekTo(0)} disabled={dur <= 0}>
                  <RestartAltIcon />
                </IconButton>
                <Tooltip
                  title={
                    loopVideo
                      ? 'Loop on — video repeats from start at the end'
                      : 'Loop off — video stops at the end'
                  }
                >
                  {/*
                    Disabled buttons swallow pointer events, so MUI's Tooltip
                    can't attach listeners to them directly. Wrapping in a
                    <span> with the listener target keeps the tooltip working
                    even when dur === 0.
                  */}
                  <span>
                    <IconButton
                      onClick={() => setLoopVideo((v) => !v)}
                      disabled={dur <= 0}
                      sx={{ color: loopVideo ? '#22d3ee' : 'inherit' }}
                    >
                      {loopVideo ? <RepeatOnIcon /> : <RepeatIcon />}
                    </IconButton>
                  </span>
                </Tooltip>
                <Box sx={{ flex: 1, mx: 1 }}>
                  <Slider
                    size="small"
                    min={0}
                    max={Math.max(0.01, dur)}
                    step={0.01}
                    value={Math.min(time, dur)}
                    onChange={(_, v) => seekTo(v as number)}
                    disabled={dur <= 0}
                  />
                </Box>
                <Typography
                  variant="caption"
                  sx={{ minWidth: 76, textAlign: 'right', color: 'text.secondary' }}
                >
                  {time.toFixed(1)}s / {dur.toFixed(1)}s
                </Typography>
              </Stack>
            </Paper>

            <Paper sx={{ p: 2 }}>
              <Timeline
                clips={project.clips}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onUpdate={updateClip}
                onRemove={removeClip}
                onMove={moveClip}
                onDuplicate={duplicateClip}
                captionsEnabled={project.captionsEnabled}
              />
            </Paper>
          </Stack>
        </Stack>

        <Box mt={4} textAlign="center">
          <Typography variant="caption" color="text.secondary">
            Built with React + Vite + TypeScript + Tailwind + MUI • Renders 1080×1920 @ 30fps •
            Output: WebM (VP9 + Opus). Drop into YouTube Shorts directly.
          </Typography>
        </Box>
      </Container>

      {/*
        Per-word transcript editor — opens from the ScriptPanel "Edit words"
        button. Only useful after Whisper has produced word-level timestamps,
        but harmless to mount at all times.
      */}
      <TranscriptEditorDialog
        open={transcriptEditorOpen}
        script={project.script}
        onClose={() => setTranscriptEditorOpen(false)}
        onSave={(next) => setProject((p) => ({ ...p, script: next }))}
      />
    </Box>
  );
}
