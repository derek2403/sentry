(() => {
  "use strict";

  const cfg = window.SENTRY_CONFIG;
  const cams = cfg.cameras;
  const camById = new Map(cams.map((c) => [c.id, c]));
  const SVG_NS = "http://www.w3.org/2000/svg";

  // How far the view zooms in so there is room to look around.
  // The cursor then slides the frame up to the edge of the zoomed image.
  const PAN_ZOOM = 1.3;
  const PAN_RANGE = ((PAN_ZOOM - 1) / (2 * PAN_ZOOM)) * 100; // % of the frame
  const PAN_EASE = 0.12;
  const PTZ_INTERVAL_MS = 120;

  const $ = (sel) => document.querySelector(sel);
  const screen = $("#screen");
  const videos = new Map(); // camId -> <video>
  const chips = new Map(); // camId -> map button
  const hasVideo = new Set(); // camIds whose video is playing
  const alerts = new Map(); // camId -> alert title
  const webcam = new Map(); // camId -> { status, track, ptz }

  let current = cams[0].id;

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

  function svg(tag, attrs, parent) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    parent.append(node);
    return node;
  }

  // ---------- Videos ----------

  function buildVideos() {
    for (const cam of cams) {
      const video = document.createElement("video");
      video.muted = true;
      video.loop = cam.source !== "webcam";
      video.playsInline = true;
      video.preload = "auto";
      video.addEventListener("loadeddata", () => {
        hasVideo.add(cam.id);
        video.play().catch(() => {});
        render();
      });
      video.addEventListener("error", () => {
        hasVideo.delete(cam.id);
        render();
      });
      if (cam.source === "webcam") webcam.set(cam.id, { status: "off" });
      else if (cam.src) video.src = cam.src;
      $("#feeds").append(video);
      videos.set(cam.id, video);
    }
  }

  // Files play straight from this computer. Nothing is uploaded.
  function loadFile(camId, file) {
    if (webcam.has(camId)) return;
    const video = videos.get(camId);
    if (video.src.startsWith("blob:")) URL.revokeObjectURL(video.src);
    video.src = URL.createObjectURL(file);
    video.load();
  }

  // ---------- This PC's camera ----------

  async function startWebcam(camId) {
    const cam = webcam.get(camId);
    if (!cam || cam.status === "asking" || cam.status === "on") return;

    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      cam.status = "insecure";
      render();
      return;
    }

    cam.status = "asking";
    render();
    try {
      // Asking for pan/tilt lets cameras with motors turn for real.
      // Browsers and cameras without it simply ignore these.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 }, pan: true, tilt: true },
        audio: false,
      });
      const track = stream.getVideoTracks()[0];
      const caps = track.getCapabilities?.() || {};
      cam.track = track;
      cam.ptz = caps.pan || caps.tilt ? { pan: caps.pan, tilt: caps.tilt } : null;
      cam.status = "on";
      track.addEventListener("ended", () => {
        cam.status = "off";
        cam.track = null;
        hasVideo.delete(camId);
        render();
      });
      const video = videos.get(camId);
      video.classList.toggle("is-ptz", !!cam.ptz);
      video.srcObject = stream;
    } catch (err) {
      cam.status = {
        NotAllowedError: "denied",
        SecurityError: "denied",
        NotFoundError: "missing",
        OverconstrainedError: "missing",
        NotReadableError: "busy",
      }[err.name] || "failed";
    }
    render();
  }

  const WEBCAM_MESSAGES = {
    off: ["Turn on this PC's camera", "Your browser will ask for permission. Video stays on this computer.", "Turn on camera"],
    asking: ["Waiting for permission", "Choose Allow in the browser's camera prompt.", null],
    on: ["Starting camera", "", null],
    denied: ["Camera access is blocked", "Click the camera icon in the address bar, allow access, then try again.", "Try again"],
    missing: ["No camera found", "Plug in a webcam, then try again.", "Try again"],
    busy: ["Camera is in use", "Close other apps using the camera (Zoom, Teams, the Camera app), then try again.", "Try again"],
    failed: ["Couldn't start the camera", "Check that it's connected, then try again.", "Try again"],
    insecure: ["Camera needs a secure address", "Browsers only allow cameras on https or localhost. Open http://localhost:8080 on this PC.", null],
  };

  // ---------- Look around with the cursor ----------

  const pan = { x: 0, y: 0, tx: 0, ty: 0 };
  let lastPtz = 0;

  function onPointerMove(e) {
    if (window.SentryUI?.dragging) return; // moving a panel shouldn't swing the view
    pan.tx = Math.max(-1, Math.min(1, (e.clientX / window.innerWidth) * 2 - 1));
    pan.ty = Math.max(-1, Math.min(1, (e.clientY / window.innerHeight) * 2 - 1));
    steerHardware();
  }

  function panStep() {
    pan.x += (pan.tx - pan.x) * PAN_EASE;
    pan.y += (pan.ty - pan.y) * PAN_EASE;
    // Cursor to the right shows more of the right side, so the frame slides left.
    const transform = `scale(${PAN_ZOOM}) translate(${(-pan.x * PAN_RANGE).toFixed(2)}%, ${(-pan.y * PAN_RANGE).toFixed(2)}%)`;
    videos.get(current).style.transform = transform;
    requestAnimationFrame(panStep);
  }

  // Cameras with pan/tilt motors turn for real instead of the digital pan.
  function steerHardware() {
    const cam = webcam.get(current);
    if (!cam?.ptz || !cam.track) return;
    const now = performance.now();
    if (now - lastPtz < PTZ_INTERVAL_MS) return;
    lastPtz = now;
    const target = {};
    if (cam.ptz.pan) target.pan = toRange(cam.ptz.pan, pan.tx);
    if (cam.ptz.tilt) target.tilt = toRange(cam.ptz.tilt, -pan.ty); // cursor up tilts up
    cam.track.applyConstraints({ advanced: [target] }).catch(() => {});
  }

  function toRange({ min, max, step }, t) {
    const value = min + ((t + 1) / 2) * (max - min);
    return step ? Math.round(value / step) * step : value;
  }

  // ---------- Map ----------

  function buildMap() {
    const root = $("#mapSvg");
    for (const room of cfg.rooms) {
      svg("rect", { class: "m-room", x: room.x, y: room.y, width: room.w, height: room.h }, root);
      svg("text", { class: "m-room-label", x: room.x + 8, y: room.y + room.h - 9 }, root).textContent = room.name;
    }

    if (cfg.atom) {
      const g = svg("g", { class: "m-you", transform: `translate(${cfg.atom.x} ${cfg.atom.y})` }, root);
      svg("title", {}, g).textContent = "Sentry AI box";
      svg("rect", { width: 56, height: 46 }, g);
      svg("text", { x: 9, y: 19 }, g).textContent = "ATOM";
      svg("rect", { class: "m-you-dot", x: 23, y: 26, width: 10, height: 10 }, g);
    }

    for (const cam of cams) {
      const g = svg("g", {
        class: "m-cam",
        role: "button",
        tabindex: 0,
        "aria-label": `Camera ${cam.code}, ${cam.name}`,
        transform: `translate(${cam.chip.x} ${cam.chip.y})`,
      }, root);
      svg("rect", { width: 66, height: 46 }, g);
      svg("text", { x: 8, y: 20 }, g).textContent = "CAM";
      svg("text", { x: 8, y: 39 }, g).textContent = cam.code;
      g.addEventListener("click", () => show(cam.id));
      g.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          show(cam.id);
        }
      });
      chips.set(cam.id, g);
    }
  }

  // ---------- Switching ----------

  function show(camId) {
    if (!camById.has(camId)) return;
    if (camId !== current) {
      const flash = $("#flash");
      flash.classList.remove("is-on");
      void flash.offsetWidth; // restart the animation
      flash.classList.add("is-on");
    }
    const changed = camId !== current;
    current = camId;
    render();
    if (webcam.get(camId)?.status === "off") startWebcam(camId);
    if (changed) window.dispatchEvent(new CustomEvent("sentry:camera", { detail: { camId } }));
  }

  function render() {
    const cam = camById.get(current);
    for (const [id, video] of videos) video.classList.toggle("is-active", id === current);
    for (const [id, chip] of chips) {
      chip.classList.toggle("is-active", id === current);
      chip.classList.toggle("is-empty", !hasVideo.has(id));
      chip.classList.toggle("is-alert", alerts.has(id));
      chip.setAttribute("aria-pressed", String(id === current));
    }

    $("#roomName").textContent = cam.name;
    $("#mapPillLabel").textContent = `CAM ${cam.code} ${cam.name}`;
    $("#mapPill").classList.toggle("is-alert", alerts.size > 0);
    $("#mapPill").title = alerts.size > 0 ? `Show map. ${alerts.size} camera${alerts.size > 1 ? "s" : ""} in alert` : "Show map";
    const alert = alerts.get(current);
    $("#roomAlert").hidden = !alert;
    $("#roomAlert").innerHTML = alert ? `${esc(alert)}<span class="ra-ok">Mark OK</span>` : "";

    const empty = !hasVideo.has(current);
    $("#empty").hidden = !empty;
    if (!empty) return;

    const cam$ = webcam.get(current);
    $("#fileBtn").hidden = !!cam$;
    $("#webcamBtn").hidden = true;
    if (cam$) {
      const [title, hint, action] = WEBCAM_MESSAGES[cam$.status] || WEBCAM_MESSAGES.failed;
      $("#emptyTitle").textContent = title;
      $("#emptyHint").textContent = hint;
      $("#webcamBtn").hidden = !action;
      $("#webcamBtn").textContent = action || "";
    } else {
      $("#emptyTitle").textContent = "No video yet";
      $("#emptyHint").innerHTML = cam.src
        ? `Save a clip as <code>${esc(cam.src)}</code>, or drop a video here.`
        : "Drop a video here to play it on this camera.";
    }
  }

  // ---------- Init ----------

  buildVideos();
  buildMap();
  window.SentryUI.minimisable({
    panel: $("#map"),
    pill: $("#mapPill"),
    minButton: $("#mapMin"),
    key: "sentry.map.minimised",
  });
  show(current);
  requestAnimationFrame(panStep);

  window.addEventListener("pointermove", onPointerMove);

  $("#roomAlert").addEventListener("click", () => {
    alerts.delete(current);
    render();
  });

  $("#webcamBtn").addEventListener("click", () => {
    const cam = webcam.get(current);
    if (cam && cam.status !== "on") {
      cam.status = "off";
      startWebcam(current);
    }
  });

  $("#fileInput").addEventListener("change", (e) => {
    if (e.target.files[0]) loadFile(current, e.target.files[0]);
    e.target.value = "";
  });

  screen.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (!webcam.has(current)) screen.classList.add("is-drop");
  });
  screen.addEventListener("dragleave", (e) => {
    if (e.target === screen || !screen.contains(e.relatedTarget)) screen.classList.remove("is-drop");
  });
  screen.addEventListener("drop", (e) => {
    e.preventDefault();
    screen.classList.remove("is-drop");
    const file = [...e.dataTransfer.files].find((f) => f.type.startsWith("video/"));
    if (file) loadFile(current, file);
  });

  // Hook for the Sentry backend:
  //   Sentry.alert("kitchen", "Smoke near the stove")  flashes that camera's button red
  //   Sentry.clear("kitchen")                          stops it
  //   Sentry.show("kitchen")                           switches to that camera
  // The AI log (ai-log.js) also uses the camera lookups below.
  window.Sentry = {
    show,
    currentCamera: () => current,
    camera: (camId) => camById.get(camId),
    hasVideo: (camId) => hasVideo.has(camId),
    videoFor: (camId) => videos.get(camId),
    alert(camId, title = "Emergency detected") {
      alerts.set(camId, title);
      render();
    },
    clear(camId) {
      alerts.delete(camId);
      render();
    },
  };
})();
