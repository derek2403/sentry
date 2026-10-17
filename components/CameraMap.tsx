"use client";

import { ATOM_POSITION, CAMERAS, ROOMS, type Camera } from "@/lib/client/cameras";
import { useMinimised } from "@/lib/client/panels";

interface Props {
  current: Camera;
  hasVideo: Set<string>;
  alertCameras: Set<string>;
  alertTitle: string | null; // alert on the camera on screen
  canUpload: boolean;
  onSelect: (camId: string) => void;
  onMarkOk: () => void;
  onUpload: () => void;
}

const MinimiseIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M3 8h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

/** The floor plan with a CAM button per camera, FNAF style. */
export default function CameraMap({ current, hasVideo, alertCameras, alertTitle, canUpload, onSelect, onMarkOk, onUpload }: Props) {
  const [minimised, setMinimised] = useMinimised("sentry.map.minimised");
  const alertCount = alertCameras.size;

  return (
    <>
      <section className="map" aria-label="Camera map" hidden={minimised}>
        <div className="map-head">
          <h1 className="room-name">{current.name}</h1>
          <div className="map-actions">
            <button
              className="map-upload"
              type="button"
              onClick={(e) => {
                e.currentTarget.blur(); // so Space starts the new clip instead of reopening the picker
                onUpload();
              }}
              hidden={!canUpload}
              title="Play a video on this camera (press Space to start it)"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M8 11V2.5M4.5 6 8 2.5 11.5 6M2.5 10.5v3h11v-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Upload video
            </button>
            <button className="panel-min" type="button" aria-label="Minimise map" title="Minimise" onClick={() => setMinimised(true)}>
              <MinimiseIcon />
            </button>
          </div>
        </div>
        {alertTitle && (
          <button
            className="room-alert"
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              onMarkOk();
            }}
          >
            {alertTitle}
            <span className="ra-ok">Mark OK</span>
          </button>
        )}
        <svg id="mapSvg" viewBox="0 0 640 430">
          {ROOMS.map((room) => (
            <g key={room.id}>
              <rect className="m-room" x={room.x} y={room.y} width={room.w} height={room.h} />
              <text className="m-room-label" x={room.x + 8} y={room.y + room.h - 9}>
                {room.name}
              </text>
            </g>
          ))}
          <g className="m-you" transform={`translate(${ATOM_POSITION.x} ${ATOM_POSITION.y})`}>
            <title>Sentry AI box</title>
            <rect width={56} height={46} />
            <text x={9} y={19}>
              ATOM
            </text>
            <rect className="m-you-dot" x={23} y={26} width={10} height={10} />
          </g>
          {CAMERAS.map((cam) => {
            const classes = ["m-cam"];
            if (cam.id === current.id) classes.push("is-active");
            if (!hasVideo.has(cam.id)) classes.push("is-empty");
            if (alertCameras.has(cam.id)) classes.push("is-alert");
            return (
              <g
                key={cam.id}
                className={classes.join(" ")}
                role="button"
                tabIndex={0}
                aria-label={`Camera ${cam.code}, ${cam.name}`}
                aria-pressed={cam.id === current.id}
                transform={`translate(${cam.chip.x} ${cam.chip.y})`}
                onClick={(e) => {
                  onSelect(cam.id);
                  // A mouse click shouldn't keep focus here, so Space then starts the clip.
                  if (e.detail > 0) (e.currentTarget as SVGGElement).blur();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(cam.id);
                  }
                }}
              >
                <rect width={66} height={46} />
                <text x={8} y={20}>
                  CAM
                </text>
                <text x={8} y={39}>
                  {cam.code}
                </text>
              </g>
            );
          })}
        </svg>
      </section>
      <button
        className={`map-pill${alertCount > 0 ? " is-alert" : ""}`}
        type="button"
        hidden={!minimised}
        onClick={() => setMinimised(false)}
        title={alertCount > 0 ? `Show map. ${alertCount} camera${alertCount > 1 ? "s" : ""} in alert` : "Show map"}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <rect x="1.5" y="2.5" width="13" height="11" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M7 2.5v6h7.5M7 8.5v5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
        <span>
          CAM {current.code} {current.name}
        </span>
      </button>
    </>
  );
}
