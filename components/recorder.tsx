"use client";

import { createClient, LiveTranscriptionEvents, LiveClient } from "@deepgram/sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { transcriptionManager } from "@/lib/transcriptionManager";
import type { InterviewLanguage } from "@/lib/types";
import { LANGUAGE_OPTIONS } from "@/lib/types";
import type { TranslationLanguage } from "@/lib/transcript-translation-queue";

interface RecorderTranscriberProps {
  addTextinTranscription: (text: string, speaker?: "user" | "system" | "external") => void;
  language: InterviewLanguage;
  onLanguageChange: (language: InterviewLanguage) => void;
  translationLanguage: TranslationLanguage;
  onTranslationLanguageChange: (language: TranslationLanguage) => void;
  answerLanguage: InterviewLanguage;
  onAnswerLanguageChange: (language: InterviewLanguage) => void;
}

export default function RecorderTranscriber({ addTextinTranscription, language, onLanguageChange,
  translationLanguage, onTranslationLanguageChange, answerLanguage, onAnswerLanguageChange }: RecorderTranscriberProps) {
  const [source, setSource] = useState("system");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const [caption, setCaption] = useState("");
  const [minimized, setMinimized] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const addTextRef = useRef(addTextinTranscription);
  addTextRef.current = addTextinTranscription;

  const disconnect = useCallback(() => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    setStream(null);
    setListening(false);
    setConnecting(false);
    setCaption("");
    transcriptionManager.reset();
  }, []);

  const connect = async () => {
    setError("");
    setConnecting(true);
    try {
      const captured = source === "microphone"
        ? await navigator.mediaDevices.getUserMedia({ audio: true })
        : await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      if (!captured.getAudioTracks().length) {
        captured.getTracks().forEach(track => track.stop());
        throw new Error("No shared audio. Select a browser tab and enable tab audio.");
      }
      streamRef.current = captured;
      setStream(captured);
      setCaption("");
      transcriptionManager.reset();
    } catch (cause) {
      setConnecting(false);
      setError(cause instanceof Error ? cause.message : "Cannot access audio. Check browser permissions.");
    }
  };

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream, minimized]);

  useEffect(() => {
    if (!stream) return;
    let cancelled = false;
    let connection: LiveClient | undefined;
    let recorder: MediaRecorder | undefined;
    let keepAlive: ReturnType<typeof setInterval> | undefined;
    const abortController = new AbortController();
    const fail = (message: string) => {
      if (cancelled) return;
      setError(message);
      disconnect();
    };
    const timeout = setTimeout(() => fail("Transcription connection timed out. Check the network and Deepgram key."), 20000);
    const onEnded = () => disconnect();
    stream.getTracks().forEach(track => track.addEventListener("ended", onEnded));

    const start = async () => {
      try {
        const response = await fetch("/api/deepgram", { cache: "no-store", signal: abortController.signal });
        const data = await response.json();
        if (cancelled) return;
        if (!response.ok || !data.key) throw new Error(data.error || "Cannot obtain a temporary Deepgram key.");
        connection = createClient(data.key).listen.live({
          model: "nova-2", language, interim_results: true, smart_format: true,
          punctuate: true, diarize: false, utterance_end_ms: 1000, vad_events: true, endpointing: 300,
        });
        const live = connection;
        live.on(LiveTranscriptionEvents.Open, () => {
          if (cancelled) return;
          clearTimeout(timeout);
          try {
            // Start only after the websocket opens, preserving the recording's container header.
            recorder = new MediaRecorder(new MediaStream(stream.getAudioTracks()));
            recorder.ondataavailable = event => {
              if (!cancelled && event.data.size > 0) live.send(event.data);
            };
            recorder.onerror = () => fail("Recording failed. Reconnect and check audio permissions.");
            recorder.start(250);
            setListening(true);
            setConnecting(false);
            keepAlive = setInterval(() => live.keepAlive(), 3000);
          } catch {
            fail("The browser could not record this audio. Check the device and reconnect.");
          }
        });
        live.on(LiveTranscriptionEvents.Transcript, data => {
          if (cancelled) return;
          const text = data.channel?.alternatives?.[0]?.transcript?.trim();
          if (!text) return;
          setCaption(text);
          if (data.is_final && transcriptionManager.shouldAddTranscript(text, true, "external", language)) {
            addTextRef.current(text, "external");
          }
        });
        live.on(LiveTranscriptionEvents.Error, () => fail("Deepgram connection failed. Check the key, balance, and network."));
        live.on(LiveTranscriptionEvents.Close, () => fail("Transcription disconnected. Check Deepgram configuration and network, then reconnect."));
      } catch (cause) {
        fail(cause instanceof Error ? cause.message : "Cannot connect to transcription.");
      }
    };
    void start();
    return () => {
      cancelled = true;
      abortController.abort();
      clearTimeout(timeout);
      if (keepAlive) clearInterval(keepAlive);
      stream.getTracks().forEach(track => {
        track.removeEventListener("ended", onEnded);
        track.stop();
      });
      if (recorder && recorder.state !== "inactive") recorder.stop();
      connection?.requestClose();
    };
  }, [stream, language, disconnect]);

  return (
    <div className="w-full relative space-y-3">
      <div className="flex flex-wrap gap-3 text-sm">
        <label className="flex items-center gap-2">Audio source
          <select className="border rounded p-2" value={source} disabled={!!stream || connecting} onChange={event => setSource(event.target.value)}>
            <option value="system">Meeting / tab audio</option>
            <option value="microphone">Microphone (test yourself)</option>
          </select>
        </label>
        <label className="flex items-center gap-2">Transcription language
          <select className="border rounded p-2" value={language} disabled={!!stream || connecting} onChange={event => onLanguageChange(event.target.value as InterviewLanguage)}>
            {LANGUAGE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2">Translation language
          <select className="border rounded p-2" value={translationLanguage} onChange={event => onTranslationLanguageChange(event.target.value as TranslationLanguage)}>
            <option value="off">Off</option>
            {LANGUAGE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2">Answer language
          <select className="border rounded p-2" value={answerLanguage} onChange={event => onAnswerLanguageChange(event.target.value as InterviewLanguage)}>
            {LANGUAGE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      </div>
      <Button className="w-full h-9 bg-green-600 hover:bg-green-800 text-white" disabled={connecting && !stream} onClick={stream ? disconnect : connect}>
        {stream ? "Disconnect" : connecting ? "Connecting..." : "Connect"}
      </Button>
      <p className="text-xs text-gray-600" role="status">
        {connecting ? "Connecting to transcription…" : listening ? "Transcription connected. Waiting for speech…" : "Transcription disconnected"}
      </p>
      <p className="text-xs text-gray-600">
        {source === "system" ? "Captures shared-tab playback only. Enable tab audio when sharing; your microphone is not included."
          : "Captures your microphone without a meeting. Audio is sent to Deepgram for transcription."}
      </p>
      <p className="text-xs text-gray-500">Automatic translation uses your configured model API and may incur usage charges. Select Off to disable it.</p>
      {error && <p role="alert" className="text-sm text-red-700 border border-red-300 p-3">{error}</p>}
      {caption && <p className="text-sm border p-3" aria-live="polite">{caption}</p>}
      {!!stream?.getVideoTracks().length && (
        <div className="p-4 border border-gray-300 bg-gray-50">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">Screen Share Preview</h3>
            <button className="text-xs border px-3 py-1" onClick={() => setMinimized(!minimized)}>{minimized ? "Show" : "Hide"}</button>
          </div>
          {!minimized && <video ref={videoRef} className="w-full h-64 bg-black object-contain" muted playsInline autoPlay />}
        </div>
      )}
    </div>
  );
}
