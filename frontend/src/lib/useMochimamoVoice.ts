"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { synthesizeChatSpeech } from "@/lib/api";

interface SpeakOptions {
  apiKey?: string;
  accessCode?: string;
  force?: boolean;
  voice?: string;
}

/**
 * Manages Gemini TTS playback (response_modalities=["AUDIO"]), mute state,
 * per-message audio caching, and real-time Web Audio RMS amplitude metering
 * to drive Mochimamo's lip-sync animation.
 */
export function useMochimamoVoice() {
  const [muted, setMuted] = useState(false);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);

  const mutedRef = useRef(muted);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  const audioLevelRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const meterRafRef = useRef<number | null>(null);
  const sessionNonceRef = useRef(0);
  const cacheRef = useRef<Map<string, ArrayBuffer>>(new Map());

  const getOrCreateAudioContext = useCallback((): AudioContext | null => {
    if (typeof window === "undefined") return null;
    if (!audioCtxRef.current) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      audioCtxRef.current = new Ctor();
    }
    return audioCtxRef.current;
  }, []);

  const unlockAudio = useCallback(() => {
    const ctx = getOrCreateAudioContext();
    if (ctx && ctx.state === "suspended") {
      void ctx.resume().catch(() => {});
    }
  }, [getOrCreateAudioContext]);

  const stopMeter = useCallback(() => {
    if (meterRafRef.current !== null) {
      window.cancelAnimationFrame(meterRafRef.current);
      meterRafRef.current = null;
    }
    audioLevelRef.current = 0;
  }, []);

  const stopAudio = useCallback(() => {
    sessionNonceRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    if (sourceRef.current) {
      try {
        sourceRef.current.onended = null;
        sourceRef.current.stop();
        sourceRef.current.disconnect();
      } catch {
        // already stopped
      }
      sourceRef.current = null;
    }
    stopMeter();
    setAudioLoading(false);
    setAudioPlaying(false);
    setPlayingMessageId(null);
  }, [stopMeter]);

  useEffect(() => {
    return () => {
      stopAudio();
      if (audioCtxRef.current) {
        void audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
    };
  }, [stopAudio]);

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      mutedRef.current = next;
      if (next) {
        stopAudio();
      } else {
        unlockAudio();
      }
      return next;
    });
  }, [stopAudio, unlockAudio]);

  const speakText = useCallback(
    async (messageId: string, text: string, opts: SpeakOptions = {}): Promise<boolean> => {
      const trimmed = text.trim();
      if (!trimmed) return false;
      if (mutedRef.current && !opts.force) return false;

      if (opts.force && mutedRef.current) {
        mutedRef.current = false;
        setMuted(false);
      }

      stopAudio();
      unlockAudio();
      const myNonce = sessionNonceRef.current;

      setAudioError(null);
      setAudioLoading(true);
      setPlayingMessageId(messageId);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const chosenVoice = opts.voice || "Leda";
        const cacheKey = `${chosenVoice}:${trimmed}`;
        let wavBuffer = cacheRef.current.get(cacheKey);
        if (!wavBuffer) {
          wavBuffer = await synthesizeChatSpeech(
            { text: trimmed, voice: chosenVoice },
            opts.apiKey,
            controller.signal,
            opts.accessCode
          );
          if (cacheRef.current.size >= 25) {
            const firstKey = cacheRef.current.keys().next().value;
            if (firstKey) cacheRef.current.delete(firstKey);
          }
          cacheRef.current.set(cacheKey, wavBuffer);
        }

        if (sessionNonceRef.current !== myNonce || (mutedRef.current && !opts.force)) {
          return false;
        }

        const ctx = getOrCreateAudioContext();
        if (!ctx) {
          throw new Error("このブラウザは Web Audio 再生に対応していません。");
        }
        if (ctx.state === "suspended") {
          await ctx.resume();
        }

        // Copy buffer because decodeAudioData detaches the passed ArrayBuffer
        const decoded = await ctx.decodeAudioData(wavBuffer.slice(0));
        if (sessionNonceRef.current !== myNonce || (mutedRef.current && !opts.force)) {
          return false;
        }

        const source = ctx.createBufferSource();
        source.buffer = decoded;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.45;

        source.connect(analyser);
        analyser.connect(ctx.destination);
        sourceRef.current = source;

        const timeData = new Uint8Array(analyser.fftSize);
        const sampleAmplitude = () => {
          if (sessionNonceRef.current !== myNonce) return;
          analyser.getByteTimeDomainData(timeData);
          let sumSq = 0;
          for (let i = 0; i < timeData.length; i++) {
            const norm = (timeData[i] - 128) / 128;
            sumSq += norm * norm;
          }
          const rms = Math.sqrt(sumSq / timeData.length);
          const mapped = Math.max(0, Math.min(1, (rms - 0.012) * 4.8));
          audioLevelRef.current = audioLevelRef.current * 0.3 + mapped * 0.7;
          meterRafRef.current = window.requestAnimationFrame(sampleAmplitude);
        };

        source.onended = () => {
          if (sessionNonceRef.current !== myNonce) return;
          sourceRef.current = null;
          stopMeter();
          setAudioPlaying(false);
          setPlayingMessageId(null);
        };

        setAudioLoading(false);
        setAudioPlaying(true);
        source.start(0);
        meterRafRef.current = window.requestAnimationFrame(sampleAmplitude);
        return true;
      } catch (err) {
        if ((err as Error)?.name === "AbortError" || sessionNonceRef.current !== myNonce) {
          return false;
        }
        stopMeter();
        setAudioLoading(false);
        setAudioPlaying(false);
        setPlayingMessageId(null);
        setAudioError(err instanceof Error ? err.message : "音声再生に失敗しました。");
        return false;
      }
    },
    [getOrCreateAudioContext, stopAudio, stopMeter, unlockAudio]
  );

  return {
    muted,
    audioLoading,
    audioPlaying,
    playingMessageId,
    audioError,
    audioLevelRef,
    unlockAudio,
    toggleMute,
    stopAudio,
    speakText,
    clearAudioError: () => setAudioError(null),
  };
}
