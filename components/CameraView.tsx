"use client";

import { useEffect, type RefObject } from "react";

import type { FallState, FrameVerdict } from "@/lib/types";

import { AlertIcon, CameraIcon } from "./icons";

export type Media =
  | { kind: "upload"; url: string; name: string }
  | { kind: "camera"; stream: MediaStream; name: string };

interface Props {
  videoRef: RefObject<HTMLVideoElement | null>;
  media: Media | null;
  analysing: boolean;
  fallState: FallState;
  verdict: FrameVerdict | null;
  onPlay: () => void;
  onError: () => void;
}

export default function CameraView({ videoRef, media, analysing, fallState, verdict, onPlay, onError }: Props) {
  // A camera stream has to be attached through srcObject, not src.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = media?.kind === "camera" ? media.stream : null;
  }, [videoRef, media]);

  const border =
    fallState === "confirmed" ? "border-danger alert-pulse" : fallState === "candidate" ? "border-warn" : "border-line";

  return (
    <div className={`relative aspect-video w-full overflow-hidden rounded-xl border-2 bg-black ${border}`}>
      {media ? (
        <video
          key={media.kind === "upload" ? media.url : "camera"}
          ref={videoRef}
          src={media.kind === "upload" ? media.url : undefined}
          className="size-full object-contain"
          autoPlay
          muted
          playsInline
          controls={media.kind === "upload"}
          onPlay={onPlay}
          onError={onError}
        />
      ) : (
        <div className="grid size-full place-items-center p-6 text-center">
          <div className="flex flex-col items-center gap-3 text-muted">
            <CameraIcon className="size-10" />
            <p className="font-medium text-text">No camera connected</p>
            <p className="max-w-sm text-sm">Upload a video or connect a camera. Every sampled frame is analysed by Nemotron on the ATOM.</p>
          </div>
        </div>
      )}

      {fallState !== "monitoring" && (
        <div
          className={`pointer-events-none absolute inset-x-0 top-0 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold tracking-wide text-white ${
            fallState === "confirmed" ? "bg-danger/90" : "bg-warn/90"
          }`}
        >
          <AlertIcon className="size-4" />
          {fallState === "confirmed" ? "FALL DETECTED" : "POSSIBLE FALL · CONFIRMING WITH NEMOTRON"}
        </div>
      )}

      {analysing && fallState === "monitoring" && (
        <span className="pointer-events-none absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-1 font-mono text-[11px] text-white">
          <span className="size-2 animate-pulse rounded-full bg-danger" />
          ANALYSING
        </span>
      )}

      {media && verdict && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 hidden bg-gradient-to-t from-black/85 to-transparent px-4 pt-8 pb-14 sm:block">
          <p className="text-sm text-white">
            <span className="mr-2 font-mono text-[11px] uppercase text-accent">Nemotron</span>
            {verdict.description || (verdict.person_visible ? verdict.posture : "No person in view")}
          </p>
        </div>
      )}
    </div>
  );
}
