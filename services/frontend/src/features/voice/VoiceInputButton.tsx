'use client';

// Track V — mic button for the landing search input.
// Tap to record, tap again (or auto-stop on silence) to upload → transcribe
// → deliver the transcript to the parent for review-then-search.
//
// Design decisions:
// - Two states: idle / recording. Deliberately no "uploading" spinner —
//   the transcribe call typically returns in <2s, and adding a third
//   state adds visual noise for a mobile field. The button dims + shows
//   a loader while awaiting the upstream response.
// - Auto-stop on silence: 1.2s of RMS below threshold, hard cap 15s.
//   Prevents the "user forgot to stop" battery drain without cutting
//   off natural pauses mid-sentence.
// - NO auto-search on transcript. Hebrew + trade jargon = frequent STT
//   errors ("רתך"/"רצף" both plausible in the same audio window).
//   Populate the input and let the user proofread + hit חפש.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, Square, Loader2 } from 'lucide-react';
import { BASE } from '@/lib/api/client';

interface Props {
  onTranscript: (text: string) => void;
  onError?:     (message: string) => void;
  className?:   string;
  disabled?:    boolean;
}

// Auto-stop tuning. Threshold is on a 0-255 byte-frequency scale; 8 is
// "quieter than typical room ambience but louder than digital silence".
// Silence-window shorter than a natural clause pause → premature cuts.
const SILENCE_THRESHOLD    = 8;
const SILENCE_HOLD_MS      = 1200;
const MAX_RECORDING_MS     = 15_000;

type State = 'idle' | 'recording' | 'transcribing';

export function VoiceInputButton({ onTranscript, onError, className, disabled }: Props) {
  const [state, setState] = useState<State>('idle');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef        = useRef<MediaStream | null>(null);
  const chunksRef        = useRef<BlobPart[]>([]);
  const audioCtxRef      = useRef<AudioContext | null>(null);
  const analyserRef      = useRef<AnalyserNode | null>(null);
  const silenceSinceRef  = useRef<number | null>(null);
  const rafRef           = useRef<number | null>(null);
  const hardCapTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Always-clean teardown — closing the audio context releases the mic
  // indicator, which is important for user trust on mobile.
  const cleanup = useCallback(() => {
    if (rafRef.current !== null)         cancelAnimationFrame(rafRef.current);
    if (hardCapTimerRef.current)         clearTimeout(hardCapTimerRef.current);
    rafRef.current          = null;
    hardCapTimerRef.current = null;
    silenceSinceRef.current = null;

    const stream = streamRef.current;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    const ctx = audioCtxRef.current;
    if (ctx && ctx.state !== 'closed') ctx.close().catch(() => {});
    audioCtxRef.current = null;
    analyserRef.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const stopRecording = useCallback(() => {
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== 'inactive') mr.stop();
  }, []);

  const startSilenceWatcher = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const buf = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteFrequencyData(buf);
      // Peak of the band. Avg would smear over low-freq HVAC noise and
      // never trip; peak matches speech which spikes across bands.
      let peak = 0;
      for (let i = 0; i < buf.length; i++) if (buf[i] > peak) peak = buf[i];

      const now = performance.now();
      if (peak < SILENCE_THRESHOLD) {
        if (silenceSinceRef.current === null) silenceSinceRef.current = now;
        else if (now - silenceSinceRef.current > SILENCE_HOLD_MS) {
          stopRecording();
          return;
        }
      } else {
        silenceSinceRef.current = null;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [stopRecording]);

  const startRecording = useCallback(async () => {
    if (state !== 'idle') return;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const isPermission = (err as DOMException).name === 'NotAllowedError' || (err as DOMException).name === 'PermissionDeniedError';
      onError?.(isPermission
        ? 'אין גישה למיקרופון. ניתן לאפשר גישה בהגדרות הדפדפן.'
        : 'לא ניתן להפעיל את המיקרופון. נסה שוב.');
      return;
    }
    streamRef.current = stream;

    // MIME hierarchy — prefer opus (small + Scribe-native), fall back to
    // whatever the browser gives us. Safari on iOS < 17 records mp4/aac
    // via MediaRecorder; both formats work with Scribe.
    const candidateMimes = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/ogg;codecs=opus',
    ];
    const mimeType = candidateMimes.find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
    const mr = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    mediaRecorderRef.current = mr;
    chunksRef.current = [];

    mr.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };

    mr.onstop = async () => {
      const capturedMime = mr.mimeType || mimeType || 'audio/webm';
      cleanup();
      const blob = new Blob(chunksRef.current, { type: capturedMime });
      chunksRef.current = [];
      if (blob.size === 0) { setState('idle'); return; }

      setState('transcribing');
      try {
        const res = await fetch(`${BASE}/voice/transcribe`, {
          method:  'POST',
          headers: { 'Content-Type': capturedMime },
          body:    blob,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          onError?.((err as { message?: string }).message || 'תקלה בתמלול. נסה שוב.');
          return;
        }
        const data = await res.json() as { transcript: string };
        if (data.transcript) onTranscript(data.transcript);
        else onError?.('לא זוהתה דיבור. נסה להקליט שוב.');
      } catch {
        onError?.('תקלה בתמלול. בדוק את החיבור ונסה שוב.');
      } finally {
        setState('idle');
      }
    };

    // Set up silence detection BEFORE start() so we don't miss the
    // opening quiet moment.
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    audioCtxRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    analyserRef.current = analyser;

    mr.start();
    setState('recording');
    silenceSinceRef.current = null;
    startSilenceWatcher();

    hardCapTimerRef.current = setTimeout(() => stopRecording(), MAX_RECORDING_MS);
  }, [state, cleanup, onError, onTranscript, startSilenceWatcher, stopRecording]);

  const handleClick = useCallback(() => {
    if (state === 'idle')       startRecording();
    else if (state === 'recording') stopRecording();
    // transcribing → click is a no-op
  }, [state, startRecording, stopRecording]);

  const isBusy = state === 'transcribing';
  const label  = state === 'recording'    ? 'עצור הקלטה'
               : state === 'transcribing' ? 'מתמלל…'
               :                            'חיפוש קולי';

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || isBusy}
      aria-label={label}
      aria-pressed={state === 'recording'}
      className={
        `relative shrink-0 inline-flex items-center justify-center w-11 h-11 rounded-full transition ` +
        (state === 'recording'
          ? 'bg-red-100 text-red-700 ring-2 ring-red-500 animate-pulse'
          : 'bg-slate-100 text-slate-600 hover:bg-brand-50 hover:text-brand-700') +
        ' disabled:opacity-60 disabled:cursor-not-allowed ' +
        (className ?? '')
      }
    >
      {state === 'transcribing' ? <Loader2 className="w-5 h-5 animate-spin" />
        : state === 'recording'  ? <Square className="w-5 h-5 fill-current" />
        :                          <Mic className="w-5 h-5" />}
      {/* Screen-reader announcement — re-fires on every state change. */}
      <span className="sr-only" aria-live="polite">{label}</span>
    </button>
  );
}
