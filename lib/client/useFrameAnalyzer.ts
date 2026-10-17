"use client";

import { useEffect, useRef } from "react";

import type { FallState, FrameResult, SessionInfo, SourceKind, StatusResponse } from "../types";

export interface AnalyzerSource {
  kind: SourceKind;
  name: string; // display name, e.g. "1A Living room"
  camera: string | null; // camera id
  /**
   * Treat the video as a live feed: time runs on the wall clock, and once the clip ends
   * its last frame keeps being analysed, like a CCTV camera still watching the room.
   */
  live: boolean;
  /** Changes whenever a new run should start (new video, camera switch, replay). */
  runId: number;
}

interface Options {
  /** The <video> element showing this source. */
  video: HTMLVideoElement | null;
  source: AnalyzerSource | null;
  analysis: StatusResponse["analysis"] | null;
  onResult: (result: FrameResult, t: number) => void;
  /** Errors raised by the analyzer; called with null once they clear. */
  onError: (message: string | null) => void;
  /** Analysis stopped by itself: the uploaded video ended, or an error it can't recover from. */
  onFinished: () => void;
  /** The user jumped back in an uploaded video: start a fresh run. */
  onRestart: () => void;
}

const RETRY_MS = 2_000;

/**
 * Samples frames from the <video> element and sends them, one at a time, to
 * Nemotron through the Sentry API. The next frame is only sent once the
 * previous verdict is back, so the model is never flooded.
 */
export function useFrameAnalyzer({ video, source, analysis, onResult, onError, onFinished, onRestart }: Options): void {
  // Keep the latest callbacks without restarting the loop.
  const callbacks = useRef({ onResult, onError, onFinished, onRestart });
  useEffect(() => {
    callbacks.current = { onResult, onError, onFinished, onRestart };
  });

  useEffect(() => {
    if (!source || !analysis || !video) return;

    const controller = new AbortController();
    const { signal } = controller;
    const canvas = document.createElement("canvas");
    let session: SessionInfo | null = null;
    let closed = false;
    let showingError = false;

    const close = (reason: string) => {
      if (!session || closed) return;
      closed = true;
      void fetch(`/api/sessions/${session.id}?reason=${encodeURIComponent(reason)}`, { method: "DELETE", keepalive: true }).catch(() => {});
    };
    const reportError = (message: string | null) => {
      // Only clear errors this hook raised, not unrelated ones shown by the dashboard.
      if (message === null && !showingError) return;
      showingError = message !== null;
      callbacks.current.onError(message);
    };

    const run = async () => {
      // React StrictMode mounts, unmounts and remounts effects in development. Waiting a
      // tick lets that first throwaway mount abort before it creates a server session.
      await sleep(0, signal);
      if (signal.aborted) return;

      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: source.kind, name: source.name, camera: source.camera }),
        signal,
      });
      if (!res.ok) throw new Error(`Could not start a session (${res.status})`);
      session = (await res.json()) as SessionInfo;

      let lastT = Number.NEGATIVE_INFINITY;
      let state: FallState = "monitoring";
      let endedAt: number | null = null;
      let heldFrames = 0;
      let liveStart: number | null = null; // the live clock starts at the first analysed frame

      while (!signal.aborted) {
        let t: number;
        let held = false; // this sample is the frozen last frame of an ended video
        if (source.kind === "camera" || source.live) {
          // A live feed is analysed while it plays, and after it ends (the last frame stays
          // on screen, like a camera still pointing at the room). Not before it starts.
          if (video.readyState < 2 || (video.paused && !video.ended)) {
            await sleep(100, signal);
            continue;
          }
          liveStart ??= performance.now();
          t = (performance.now() - liveStart) / 1000;
        } else if (video.ended) {
          // The last frame stays on screen. Always analyse it at least once (the fall may
          // happen right at the end, between two samples), and keep checking it while a
          // possible fall is being confirmed.
          endedAt ??= performance.now();
          const heldFor = (performance.now() - endedAt) / 1000;
          if ((heldFrames > 0 && state !== "candidate") || heldFor > analysis.holdLastFrameS) break;
          t = video.duration + heldFor;
          held = true;
          if (heldFrames === 0) lastT = Number.NEGATIVE_INFINITY; // don't wait for the interval
        } else {
          endedAt = null;
          heldFrames = 0;
          if (video.paused || video.seeking || video.readyState < 2) {
            await sleep(100, signal);
            continue;
          }
          t = video.currentTime;
          if (t < lastT - analysis.intervalS) {
            // Jumped back (seek or replay): the old fall state no longer matches the video.
            close("replayed");
            callbacks.current.onRestart();
            return;
          }
        }

        if (t - lastT < analysis.intervalS) {
          await sleep(40, signal);
          continue;
        }

        const image = captureFrame(video, canvas, analysis.maxFrameWidth);
        if (!image) {
          await sleep(100, signal);
          continue;
        }
        lastT = t;

        let frameRes: Response;
        try {
          frameRes = await fetch(`/api/sessions/${session.id}/frames`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image, t }),
            signal,
          });
        } catch (err) {
          if (signal.aborted) return;
          reportError(`Lost connection to the Sentry server: ${err instanceof Error ? err.message : String(err)}`);
          await sleep(RETRY_MS, signal);
          continue;
        }
        if (frameRes.status === 404) throw new Error("The analysis session expired. Upload the video again.");
        if (frameRes.status >= 500 || frameRes.status === 409) {
          reportError(`Sentry server error (${frameRes.status}); retrying`);
          await sleep(RETRY_MS, signal);
          continue;
        }
        if (!frameRes.ok) {
          const body = (await frameRes.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `Frame analysis failed (${frameRes.status})`);
        }

        const result = (await frameRes.json()) as FrameResult;
        if (signal.aborted) return;
        state = result.state;
        if (held) heldFrames += 1;
        callbacks.current.onResult(result, t);
        reportError(result.error ? `Nemotron: ${result.error}` : null);
        if (result.error) await sleep(RETRY_MS, signal); // endpoint down: back off
      }

      close("video ended");
      if (!signal.aborted) callbacks.current.onFinished();
    };

    run().catch((err: unknown) => {
      if (signal.aborted) return;
      reportError(err instanceof Error ? err.message : String(err));
      close("error");
      callbacks.current.onFinished();
    });

    return () => {
      controller.abort();
      close("stopped");
    };
  }, [video, source, analysis]);
}

function captureFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement, maxWidth: number): string | null {
  if (!video.videoWidth || !video.videoHeight) return null;
  const width = Math.min(video.videoWidth, maxWidth);
  const height = Math.round((video.videoHeight * width) / video.videoWidth);
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", 0.8);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
