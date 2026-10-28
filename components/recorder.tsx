"use client";

import { createClient, LiveTranscriptionEvents, LiveClient } from "@deepgram/sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { transcriptionManager } from "@/lib/transcriptionManager";
import type { InterviewLanguage } from "@/lib/types";

interface RecorderTranscriberProps {
  addTextinTranscription: (text: string, speaker?: "user" | "system" | "external") => void;
  language: InterviewLanguage;
  onLanguageChange: (language: InterviewLanguage) => void;
}

export default function RecorderTranscriber({ addTextinTranscription, language, onLanguageChange }: RecorderTranscriberProps) {
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
        throw new Error("没有共享音频。请重新选择浏览器标签页并勾选“共享标签页音频”。");
      }
      streamRef.current = captured;
      setStream(captured);
      setCaption("");
      transcriptionManager.reset();
    } catch (cause) {
      setConnecting(false);
      setError(cause instanceof Error ? cause.message : "无法访问音频，请检查浏览器权限。");
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
    const timeout = setTimeout(() => fail("连接转写服务超时，请检查网络和 Deepgram Key 后重试。"), 20000);
    const onEnded = () => disconnect();
    stream.getTracks().forEach(track => track.addEventListener("ended", onEnded));

    const start = async () => {
      try {
        const response = await fetch("/api/deepgram", { cache: "no-store", signal: abortController.signal });
        const data = await response.json();
        if (cancelled) return;
        if (!response.ok || !data.key) throw new Error(data.error || "无法获取 Deepgram 临时密钥。");
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
            recorder.onerror = () => fail("录音失败，请重新连接并检查音频权限。");
            recorder.start(250);
            setListening(true);
            setConnecting(false);
            keepAlive = setInterval(() => live.keepAlive(), 3000);
          } catch {
            fail("浏览器无法录制此音频，请检查音频设备并重新连接。");
          }
        });
        live.on(LiveTranscriptionEvents.Transcript, data => {
          if (cancelled) return;
          const text = data.channel?.alternatives?.[0]?.transcript?.trim();
          if (!text) return;
          setCaption(text);
          if (data.is_final && transcriptionManager.shouldAddTranscript(text, true, "external")) {
            addTextRef.current(text, "external");
          }
        });
        live.on(LiveTranscriptionEvents.Error, () => fail("Deepgram 连接失败，请检查 Key、余额及网络，然后重新连接。"));
        live.on(LiveTranscriptionEvents.Close, () => fail("转写连接已断开，请重新连接。如反复出现，请检查 Deepgram 配置和网络。"));
      } catch (cause) {
        fail(cause instanceof Error ? cause.message : "无法连接转写服务。");
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
        <label className="flex items-center gap-2">音频来源
          <select className="border rounded p-2" value={source} disabled={!!stream || connecting} onChange={event => setSource(event.target.value)}>
            <option value="system">会议 / 标签页声音</option>
            <option value="microphone">麦克风（自己说话测试）</option>
          </select>
        </label>
        <label className="flex items-center gap-2">识别 / 回答语言
          <select className="border rounded p-2" value={language} disabled={!!stream || connecting} onChange={event => onLanguageChange(event.target.value as InterviewLanguage)}>
            <option value="en">English</option>
            <option value="ja">日本語（日语）</option>
            <option value="zh-CN">中文（普通话）</option>
            <option value="de">Deutsch</option>
          </select>
        </label>
      </div>
      <Button className="w-full h-9 bg-green-600 hover:bg-green-800 text-white" disabled={connecting && !stream} onClick={stream ? disconnect : connect}>
        {stream ? "Disconnect" : connecting ? "Connecting..." : "Connect"}
      </Button>
      <p className="text-xs text-gray-600" role="status">
        {connecting ? "正在连接转写服务…" : listening ? "转写服务已连接，等待所选音频中的语音…" : "未连接转写服务"}
      </p>
      <p className="text-xs text-gray-600">
        {source === "system" ? "只转写共享标签页播放的声音，不采集你自己的麦克风。共享时请勾选音频。"
          : "直接采集麦克风，无需打开 Meet。语音会发送至 Deepgram 进行转写。"}
      </p>
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
