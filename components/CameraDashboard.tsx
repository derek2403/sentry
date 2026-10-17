"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CAMERA_BY_ID, CAMERAS, DEFAULT_CAMERA, cameraLabel } from "@/lib/client/cameras";
import { panelDrag } from "@/lib/client/panels";
import { useFrameAnalyzer, type AnalyzerSource } from "@/lib/client/useFrameAnalyzer";
import type { Alert, FrameResult, StatusResponse } from "@/lib/types";

import AiLog from "./AiLog";
import CameraMap from "./CameraMap";

// How far the view zooms in so there is room to look around.
// The cursor then slides the frame up to the edge of the zoomed image.
const PAN_ZOOM = 1.3;
const PAN_RANGE = ((PAN_ZOOM - 1) / (2 * PAN_ZOOM)) * 100; // % of the frame
const PAN_EASE = 0.12;
const PTZ_INTERVAL_MS = 120;
const STATUS_POLL_MS = 3_000;
const RESTART_AFTER_ERROR_MS = 3_000;

type WebcamStatus = "off" | "asking" | "on" | "denied" | "missing" | "busy" | "failed" | "insecure";
/** Clips wait on their first frame until Space is pressed, play once, then hold their last frame. */
export type PlayState = "ready" | "playing" | "ended";

const WEBCAM_MESSAGES: Record<WebcamStatus, [string, string, string | null]> = {
  off: ["Turn on this PC's camera", "Your browser will ask for permission. Video stays on this computer.", "Turn on camera"],
  asking: ["Waiting for permission", "Choose Allow in the browser's camera prompt.", null],
  on: ["Starting camera", "", null],
  denied: ["Camera access is blocked", "Click the camera icon in the address bar, allow access, then try again.", "Try again"],
  missing: ["No camera found", "Plug in a webcam, then try again.", "Try again"],
  busy: ["Camera is in use", "Close other apps using the camera (Zoom, Teams, the Camera app), then try again.", "Try again"],
  failed: ["Couldn't start the camera", "Check that it's connected, then try again.", "Try again"],
  insecure: ["Camera needs a secure address", "Browsers only allow cameras on https or localhost. Open the dashboard on localhost on this PC.", null],
};

interface PtzRange {
  min: number;
  max: number;
  step?: number;
}
interface WebcamHandle {
  track: MediaStreamTrack | null;
  ptz: { pan?: PtzRange; tilt?: PtzRange } | null;
}

export default function CameraDashboard() {
  const [current, setCurrent] = useState(DEFAULT_CAMERA);
  const [hasVideo, setHasVideo] = useState<Set<string>>(() => new Set());
  const [fileSrc, setFileSrc] = useState<Record<string, string>>({}); // camId -> blob URL of a dropped file
  const [runVersion, setRunVersion] = useState<Record<string, number>>({}); // bump to restart analysis of a camera
  const [webcamStatus, setWebcamStatus] = useState<Record<string, WebcamStatus>>(() =>
    Object.fromEntries(CAMERAS.filter((c) => c.source === "webcam").map((c) => [c.id, "off" as WebcamStatus])),
  );
  const [videoEls, setVideoEls] = useState<Record<string, HTMLVideoElement>>({});
  const [playState, setPlayState] = useState<Record<string, PlayState>>({});
  const [flashKey, setFlashKey] = useState(0);
  const [dropping, setDropping] = useState(false);

  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [analysis, setAnalysis] = useState<StatusResponse["analysis"] | null>(null);
  const [alert, setAlert] = useState<Alert | null>(null);
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null);
  const [analyzerError, setAnalyzerError] = useState<string | null>(null);

  const webcams = useRef<Record<string, WebcamHandle>>({});
  const currentRef = useRef(current);
  const videoElsRef = useRef(videoEls);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    currentRef.current = current;
    videoElsRef.current = videoEls;
  });

  const cam = CAMERA_BY_ID.get(current)!;
  const isWebcam = cam.source === "webcam";

  // ---------- Server status: model health, settings and the active alert ----------

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
        setAnalysis((a) => a ?? body.analysis);
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

  // ---------- Videos ----------

  // One stable ref callback per camera (a new function every render would re-register each time).
  const videoRefs = useMemo(
    () =>
      Object.fromEntries(
        CAMERAS.map((c) => [
          c.id,
          (el: HTMLVideoElement | null) =>
            setVideoEls((els) => {
              if (el === (els[c.id] ?? null)) return els;
              const next = { ...els };
              if (el) next[c.id] = el;
              else delete next[c.id];
              return next;
            }),
        ]),
      ),
    [],
  );

  const markVideo = useCallback((camId: string, ok: boolean) => {
    setHasVideo((set) => {
      if (set.has(camId) === ok) return set;
      const next = new Set(set);
      if (ok) next.add(camId);
      else next.delete(camId);
      return next;
    });
  }, []);

  const restartAnalysis = useCallback((camId: string) => {
    setRunVersion((v) => ({ ...v, [camId]: (v[camId] ?? 0) + 1 }));
  }, []);

  // Files play straight from this computer. Nothing is uploaded anywhere.
  const loadFile = useCallback(
    (camId: string, file: File) => {
      if (CAMERA_BY_ID.get(camId)?.source === "webcam" || !file.type.startsWith("video/")) return;
      setFileSrc((srcs) => {
        if (srcs[camId]) URL.revokeObjectURL(srcs[camId]);
        return { ...srcs, [camId]: URL.createObjectURL(file) };
      });
      markVideo(camId, false);
      restartAnalysis(camId);
    },
    [markVideo, restartAnalysis],
  );

  // ---------- This PC's camera ----------

  const startWebcam = useCallback(
    async (camId: string) => {
      const now = webcamStatus[camId];
      if (now === undefined || now === "asking" || now === "on") return;
      const set = (s: WebcamStatus) => setWebcamStatus((all) => ({ ...all, [camId]: s }));

      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        set("insecure");
        return;
      }
      set("asking");
      try {
        // Asking for pan/tilt lets cameras with motors turn for real. Others ignore it.
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1920 }, height: { ideal: 1080 }, pan: true, tilt: true } as MediaTrackConstraints,
          audio: false,
        });
        const track = stream.getVideoTracks()[0];
        const caps = (track.getCapabilities?.() ?? {}) as { pan?: PtzRange; tilt?: PtzRange };
        webcams.current[camId] = { track, ptz: caps.pan || caps.tilt ? { pan: caps.pan, tilt: caps.tilt } : null };
        track.addEventListener("ended", () => {
          webcams.current[camId] = { track: null, ptz: null };
          set("off");
          markVideo(camId, false);
        });
        const video = videoElsRef.current[camId];
        if (video) {
          video.classList.toggle("is-ptz", !!webcams.current[camId].ptz);
          video.srcObject = stream;
        }
        set("on");
      } catch (err) {
        const name = err instanceof DOMException ? err.name : "";
        const map: Record<string, WebcamStatus> = {
          NotAllowedError: "denied",
          SecurityError: "denied",
          NotFoundError: "missing",
          OverconstrainedError: "missing",
          NotReadableError: "busy",
        };
        set(map[name] ?? "failed");
      }
    },
    [webcamStatus, markVideo],
  );

  // ---------- Switching ----------

  const show = useCallback(
    (camId: string) => {
      if (!CAMERA_BY_ID.has(camId)) return;
      if (camId !== currentRef.current) setFlashKey((k) => k + 1);
      setCurrent(camId);
      if (webcamStatus[camId] === "off") void startWebcam(camId);
    },
    [webcamStatus, startWebcam],
  );

  // ---------- Space starts the clip on screen ----------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return;
      // Leave Space alone when it would press a button or type into a field.
      if ((e.target as HTMLElement).closest("input, textarea, select, button, summary, [role='button'], [contenteditable='true']")) return;
      const camId = currentRef.current;
      const video = videoElsRef.current[camId];
      if (!video || CAMERA_BY_ID.get(camId)?.source === "webcam" || video.readyState < 2) return;
      e.preventDefault();
      if (video.ended) {
        // Play it again from the start, with a fresh analysis session.
        video.currentTime = 0;
        restartAnalysis(camId);
      }
      if (video.paused) video.play().catch(() => {});
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [restartAnalysis]);

  // ---------- Look around with the cursor ----------

  useEffect(() => {
    const pan = { x: 0, y: 0, tx: 0, ty: 0 };
    let lastPtz = 0;
    let frame = 0;

    const toRange = ({ min, max, step }: PtzRange, t: number) => {
      const value = min + ((t + 1) / 2) * (max - min);
      return step ? Math.round(value / step) * step : value;
    };
    // Cameras with pan/tilt motors turn for real instead of the digital pan.
    const steerHardware = () => {
      const handle = webcams.current[currentRef.current];
      if (!handle?.ptz || !handle.track) return;
      const now = performance.now();
      if (now - lastPtz < PTZ_INTERVAL_MS) return;
      lastPtz = now;
      const target: Record<string, number> = {};
      if (handle.ptz.pan) target.pan = toRange(handle.ptz.pan, pan.tx);
      if (handle.ptz.tilt) target.tilt = toRange(handle.ptz.tilt, -pan.ty); // cursor up tilts up
      handle.track.applyConstraints({ advanced: [target as MediaTrackConstraintSet] }).catch(() => {});
    };
    const onPointerMove = (e: PointerEvent) => {
      if (panelDrag.active) return; // moving a panel shouldn't swing the view
      pan.tx = Math.max(-1, Math.min(1, (e.clientX / window.innerWidth) * 2 - 1));
      pan.ty = Math.max(-1, Math.min(1, (e.clientY / window.innerHeight) * 2 - 1));
      steerHardware();
    };
    const step = () => {
      pan.x += (pan.tx - pan.x) * PAN_EASE;
      pan.y += (pan.ty - pan.y) * PAN_EASE;
      // Cursor to the right shows more of the right side, so the frame slides left.
      const video = videoElsRef.current[currentRef.current];
      if (video) video.style.transform = `scale(${PAN_ZOOM}) translate(${(-pan.x * PAN_RANGE).toFixed(2)}%, ${(-pan.y * PAN_RANGE).toFixed(2)}%)`;
      frame = requestAnimationFrame(step);
    };
    window.addEventListener("pointermove", onPointerMove);
    frame = requestAnimationFrame(step);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      cancelAnimationFrame(frame);
    };
  }, []);

  // ---------- Frame-by-frame analysis of the camera on screen ----------

  const currentHasVideo = hasVideo.has(current);
  const version = runVersion[current] ?? 0;
  const source = useMemo<AnalyzerSource | null>(() => {
    if (!currentHasVideo) return null;
    const c = CAMERA_BY_ID.get(current)!;
    return { kind: c.source === "webcam" ? "camera" : "upload", name: cameraLabel(c), camera: c.id, live: true, runId: version };
  }, [current, currentHasVideo, version]);

  const onResult = useCallback((result: FrameResult) => {
    if (result.verdict) setLastLatencyMs(result.latencyMs);
    if (result.alert) setAlert(result.alert);
  }, []);
  const onFinished = useCallback(() => {
    // A live feed only stops on an error it couldn't recover from: try again shortly.
    const camId = currentRef.current;
    setTimeout(() => restartAnalysis(camId), RESTART_AFTER_ERROR_MS);
  }, [restartAnalysis]);
  const onRestart = useCallback(() => restartAnalysis(currentRef.current), [restartAnalysis]);

  useFrameAnalyzer({ video: videoEls[current] ?? null, source, analysis, onResult, onError: setAnalyzerError, onFinished, onRestart });

  // ---------- Alerts ----------

  const alertCameras = useMemo(() => new Set(alert?.camera ? [alert.camera] : []), [alert]);
  const markOk = async () => {
    await fetch("/api/alert/ack", { method: "POST" }).catch(() => {});
    setAlert(null);
  };

  // ---------- Render ----------

  const webcam = isWebcam ? webcamStatus[current] ?? "failed" : null;
  const [emptyTitle, emptyHint, webcamAction] = webcam
    ? WEBCAM_MESSAGES[webcam]
    : ["No video yet", cam.src ? `Save a clip as public${cam.src}, or drop a video here.` : "Drop a video here to play it on this camera.", null];

  return (
    <main
      className={`screen${dropping ? " is-drop" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!isWebcam) setDropping(true);
      }}
      onDragLeave={(e) => {
        if (e.target === e.currentTarget || !e.currentTarget.contains(e.relatedTarget as Node)) setDropping(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDropping(false);
        const file = [...e.dataTransfer.files].find((f) => f.type.startsWith("video/"));
        if (file) loadFile(current, file);
      }}
    >
      {/* Every camera keeps playing underneath; only the selected one is shown. */}
      <div className="feeds">
        {CAMERAS.map((c) => (
          <video
            key={c.id}
            ref={videoRefs[c.id]}
            className={c.id === current ? "is-active" : undefined}
            src={c.source === "webcam" ? undefined : fileSrc[c.id] ?? c.src}
            muted
            playsInline
            preload="auto"
            onLoadedData={(e) => {
              markVideo(c.id, true);
              // A webcam plays straight away; clips wait for Space.
              if (c.source === "webcam") e.currentTarget.play().catch(() => {});
              else setPlayState((s) => ({ ...s, [c.id]: "ready" }));
            }}
            onPlay={() => setPlayState((s) => ({ ...s, [c.id]: "playing" }))}
            onEnded={() => setPlayState((s) => ({ ...s, [c.id]: "ended" }))}
            onError={() => markVideo(c.id, false)}
          />
        ))}
      </div>

      <div className="empty" hidden={currentHasVideo}>
        <p className="empty-title">{emptyTitle}</p>
        <p className="empty-hint">{emptyHint}</p>
        {!isWebcam && (
          <button className="empty-btn" type="button" onClick={() => fileInput.current?.click()}>
            Choose a video
          </button>
        )}
        {webcamAction && (
          <button className="empty-btn" type="button" onClick={() => void startWebcam(current)}>
            {webcamAction}
          </button>
        )}
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="video/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) loadFile(current, file);
          e.target.value = "";
        }}
      />

      {flashKey > 0 && <div key={flashKey} className="switch-flash is-on" />}
      <span className="rec" aria-hidden="true" />

      <AiLog
        current={cam}
        currentHasVideo={currentHasVideo}
        playState={isWebcam ? "playing" : playState[current] ?? "ready"}
        lastLatencyMs={lastLatencyMs}
        model={status?.model ?? null}
        error={analyzerError}
        onSelectCamera={show}
      />

      <CameraMap
        current={cam}
        hasVideo={hasVideo}
        alertCameras={alertCameras}
        alertTitle={alert && alert.camera === current ? "Fall detected" : null}
        canUpload={!isWebcam}
        onSelect={show}
        onMarkOk={markOk}
        onUpload={() => fileInput.current?.click()}
      />
    </main>
  );
}
