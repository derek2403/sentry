"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useFrameAnalyzer, type AnalyzerSource } from "@/lib/client/useFrameAnalyzer";
import type { Alert, FallState, FrameResult, FrameVerdict, StatusResponse } from "@/lib/types";

import AlertCard from "./AlertCard";
import AnalysisPanel from "./AnalysisPanel";
import BacklogDrawer from "./BacklogDrawer";
import CameraView, { type Media } from "./CameraView";
import { CameraIcon, ListIcon, ShieldIcon, StopIcon, UploadIcon } from "./icons";
import Timeline, { type TimelinePoint } from "./Timeline";

const STATUS_POLL_MS = 3_000;

export default function Dashboard() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const runCounter = useRef(0);

  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [analysis, setAnalysis] = useState<StatusResponse["analysis"] | null>(null);
  const [media, setMedia] = useState<Media | null>(null);
  const [run, setRun] = useState<AnalyzerSource | null>(null);
  const [verdict, setVerdict] = useState<FrameVerdict | null>(null);
  const [fallState, setFallState] = useState<FallState>("monitoring");
  const [timeline, setTimeline] = useState<TimelinePoint[]>([]);
  const [stats, setStats] = useState({ frames: 0, latencyMs: 0 });
  const [alert, setAlert] = useState<Alert | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [backlogOpen, setBacklogOpen] = useState(false);
  const [unread, setUnread] = useState(0);

  // Server status: model health, analysis settings and the active alert.
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch("/api/status", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as StatusResponse;
        if (cancelled) return;
        setStatus(body);
        setAlert(body.alert);
        // Only set once: a new object every poll would restart the analyzer.
        setAnalysis((current) => current ?? body.analysis);
      } catch {
        if (!cancelled) setStatus(null);
      }
    };
    void poll();
    const timer = setInterval(poll, STATUS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // Release the previous upload's object URL or camera stream when media changes.
  useEffect(() => {
    return () => {
      if (media?.kind === "upload") URL.revokeObjectURL(media.url);
      if (media?.kind === "camera") media.stream.getTracks().forEach((track) => track.stop());
    };
  }, [media]);

  const startRun = useCallback((kind: AnalyzerSource["kind"], name: string) => {
    runCounter.current += 1;
    setRun({ kind, name, runId: runCounter.current });
    setVerdict(null);
    setFallState("monitoring");
    setTimeline([]);
    setStats({ frames: 0, latencyMs: 0 });
    setError(null);
  }, []);

  const onUpload = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      setError(`"${file.name}" is not a video file.`);
      return;
    }
    setMedia({ kind: "upload", url: URL.createObjectURL(file), name: file.name });
    startRun("upload", file.name);
  };

  const onUseCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera access needs HTTPS or localhost. Open the dashboard via localhost (e.g. through port forwarding).");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      const name = status?.cameraName ?? "Camera";
      setMedia({ kind: "camera", stream, name });
      startRun("camera", name);
    } catch (err) {
      setError(`Could not open the camera: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // An unresolved "possible fall" means nothing once analysis stops; a confirmed fall stays on screen.
  const clearCandidate = () => setFallState((s) => (s === "candidate" ? "monitoring" : s));

  const onStop = () => {
    setRun(null);
    clearCandidate();
    if (media?.kind === "camera") setMedia(null);
    else videoRef.current?.pause();
  };

  const onVideoError = () => {
    if (media?.kind !== "upload") return;
    setError(`This browser can't play "${media.name}". Try an H.264 MP4.`);
    setRun(null);
  };

  // Replaying an uploaded video after analysis finished starts a fresh run.
  const onVideoPlay = () => {
    if (media?.kind === "upload" && run === null) startRun("upload", media.name);
  };

  const onResult = useCallback((result: FrameResult, t: number) => {
    setFallState(result.state);
    if (result.alert) setAlert(result.alert);
    if (result.verdict) {
      setVerdict(result.verdict);
      setStats((s) => ({ frames: s.frames + 1, latencyMs: result.latencyMs }));
    }
    setTimeline((points) => [...points, { t, verdict: result.verdict, state: result.state }].slice(-80));
  }, []);

  const onFinished = useCallback(() => {
    setRun(null);
    setFallState((s) => (s === "candidate" ? "monitoring" : s));
  }, []);

  const onRestart = useCallback(() => {
    if (media?.kind === "upload") startRun("upload", media.name);
  }, [media, startRun]);

  useFrameAnalyzer({ videoRef, source: run, analysis, onResult, onError: setError, onFinished, onRestart });

  const acknowledge = async () => {
    await fetch("/api/alert/ack", { method: "POST" }).catch(() => {});
    setAlert(null);
  };

  const modelReady = status?.model.reachable && !status.model.error;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1400px] flex-col gap-5 px-4 py-5 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl bg-accent/15 text-accent">
            <ShieldIcon className="size-6" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Sentry</h1>
            <p className="text-xs text-muted">Home safety monitor · on-device AI on the GIGABYTE AI TOP ATOM</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`hidden items-center gap-2 rounded-full border px-3 py-1.5 text-xs sm:inline-flex ${
              modelReady ? "border-ok/30 bg-ok/10 text-ok" : "border-danger/30 bg-danger/10 text-danger"
            }`}
            title={status?.model.error ?? status?.model.baseUrl}
          >
            <span className={`size-2 rounded-full ${modelReady ? "bg-ok" : "bg-danger"}`} />
            {modelReady ? `Nemotron ready${status?.model.id ? ` · ${status.model.id}` : ""}` : "Nemotron offline"}
          </span>
          <button
            type="button"
            onClick={() => setBacklogOpen(true)}
            className="relative inline-flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2 text-sm hover:bg-panel-2"
          >
            <ListIcon className="size-4" />
            Backlog
            {unread > 0 && (
              <span className="absolute -top-2 -right-2 grid min-w-5 place-items-center rounded-full bg-danger px-1.5 text-[11px] font-semibold text-white">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </button>
        </div>
      </header>

      <main className="grid flex-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="flex min-w-0 flex-col gap-4 rounded-2xl border border-line bg-panel p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-medium">{status?.cameraName ?? "Living room"}</h2>
              <p className="truncate text-xs text-muted">
                {media?.kind === "upload" ? `Uploaded video · ${media.name}` : media?.kind === "camera" ? "Live camera" : "No source"}
                {run ? " · analysing with Nemotron" : media ? " · analysis stopped" : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(e) => {
                  onUpload(e.target.files?.[0]);
                  e.target.value = ""; // allow re-uploading the same file
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-black hover:brightness-110"
              >
                <UploadIcon className="size-4" />
                Upload video
              </button>
              <button
                type="button"
                onClick={onUseCamera}
                className="inline-flex items-center gap-2 rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm hover:border-muted"
              >
                <CameraIcon className="size-4" />
                Use camera
              </button>
              {run && (
                <button
                  type="button"
                  onClick={onStop}
                  className="inline-flex items-center gap-2 rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm hover:border-muted"
                >
                  <StopIcon className="size-4" />
                  Stop
                </button>
              )}
            </div>
          </div>

          <CameraView
            videoRef={videoRef}
            media={media}
            analysing={run !== null}
            fallState={fallState}
            verdict={verdict}
            onPlay={onVideoPlay}
            onError={onVideoError}
          />

          {error && <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

          <Timeline points={timeline} />
        </section>

        <aside className="flex min-w-0 flex-col gap-5">
          {alert && <AlertCard alert={alert} onAcknowledge={acknowledge} />}
          <AnalysisPanel verdict={verdict} fallState={fallState} frames={stats.frames} latencyMs={stats.latencyMs} analysing={run !== null} />
        </aside>
      </main>

      <BacklogDrawer open={backlogOpen} onClose={() => setBacklogOpen(false)} onUnreadChange={setUnread} />
    </div>
  );
}
