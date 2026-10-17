// AI log: every few seconds, send a frame from the camera on screen to the
// local AI on the ATOM and show what it says it sees.
(() => {
  "use strict";

  const S = window.Sentry;
  const llm = window.SENTRY_CONFIG.llm || {};
  const BASE_URL = (llm.baseUrl || "http://localhost:8000/v1").replace(/\/+$/, "");
  const INTERVAL_MS = (llm.intervalSeconds || 10) * 1000;
  const REQUEST_TIMEOUT_MS = 30000;
  const FRAME_WIDTH = 768;
  const MAX_ENTRIES = 100;

  const SYSTEM_PROMPT = [
    "You are Sentry, a home safety monitor watching one camera frame.",
    "Reply with JSON only, no other text:",
    '{"status":"normal"|"watch"|"emergency","summary":"one or two plain sentences on what is happening","event":"short title, only if status is not normal"}',
    "Use emergency for: a person fallen or lying on the floor, fire or smoke, flooding, a child at a hazard such as an open window, stove or pool.",
    "Use watch for anything that might become one of those. Otherwise use normal.",
    "Describe people by what they are doing, never by identity.",
  ].join("\n");

  // Shown only while the AI can't be reached, and always labelled "Sample".
  const SAMPLES = {
    pc: ["A person is sitting at the desk, looking at the screen.", "The person leans back in the chair and stretches.", "Nobody is in view. The desk and chair are empty."],
    living: ["Grandma is sitting on the sofa watching TV.", "The living room is empty and the lights are on.", "Grandma is walking slowly towards the kitchen with her walker."],
    kitchen: ["Someone is stirring a pot on the stove.", "The stove is off and nobody is in the kitchen.", "A person is washing dishes at the sink."],
    grandma: ["Grandma is asleep in bed.", "Grandma is sitting on the edge of the bed putting on slippers.", "The bedroom is empty."],
    kids: ["Two children are playing on the floor with blocks.", "A child is reading on the bed.", "The room is empty and the window is closed."],
    default: ["Nothing unusual. No people in view.", "One person walks through the frame and leaves.", "The scene is quiet and unchanged."],
  };
  const sampleIndex = new Map();

  const $ = (sel) => document.querySelector(sel);
  const panel = $("#aiLog");
  const pill = $("#aiLogPill");
  const list = $("#aiLogList");
  const statusEl = $("#aiLogStatus");
  const note = $("#aiLogNote");
  const canvas = document.createElement("canvas");

  let model = llm.model || null;
  let busy = false;
  let nextAt = 0;
  let timer = null;
  let lastError = "";
  let lastStatus = "normal";

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  const pad = (n) => String(n).padStart(2, "0");
  const clock = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

  // ---------- Talking to the AI ----------

  class Offline extends Error {}

  async function request(path, body) {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    const headers = { "Content-Type": "application/json" };
    if (llm.apiKey) headers.Authorization = `Bearer ${llm.apiKey}`;
    let res;
    try {
      res = await fetch(`${BASE_URL}${path}`, {
        method: body ? "POST" : "GET",
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
    } catch {
      throw new Offline(`Can't reach the AI at ${BASE_URL}`);
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let message = text;
      try { message = JSON.parse(text).error?.message || JSON.parse(text).message || text; } catch {}
      throw new Error(`AI returned ${res.status}${message ? `: ${String(message).slice(0, 200)}` : ""}`);
    }
    return res.json();
  }

  async function resolveModel() {
    if (model) return model;
    const data = await request("/models");
    model = data.data?.[0]?.id;
    if (!model) throw new Error("The AI endpoint isn't serving any model. Set llm.model in config.js.");
    return model;
  }

  function captureFrame(video) {
    const scale = Math.min(1, FRAME_WIDTH / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.8);
  }

  async function askModel(cam, frame) {
    const data = await request("/chat/completions", {
      model: await resolveModel(),
      temperature: 0.2,
      max_tokens: 300,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: `Camera ${cam.code}, ${cam.name}. What is happening?` },
            { type: "image_url", image_url: { url: frame } },
          ],
        },
      ],
    });
    return parseVerdict(data.choices?.[0]?.message?.content || "");
  }

  function parseVerdict(text) {
    const clean = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    const json = clean.match(/\{[\s\S]*\}/);
    if (json) {
      try {
        const v = JSON.parse(json[0]);
        const status = ["normal", "watch", "emergency"].includes(v.status) ? v.status : "normal";
        return { status, summary: String(v.summary || "").trim() || clean, event: v.event ? String(v.event) : "" };
      } catch {}
    }
    return { status: "normal", summary: clean || "The AI gave an empty answer.", event: "" };
  }

  function sample(camId) {
    const lines = SAMPLES[camId] || SAMPLES.default;
    const i = sampleIndex.get(camId) || 0;
    sampleIndex.set(camId, i + 1);
    return { status: "normal", summary: lines[i % lines.length], event: "" };
  }

  // ---------- One look ----------

  async function look() {
    const camId = S.currentCamera();
    const cam = S.camera(camId);
    if (!S.hasVideo(camId)) {
      statusEl.textContent = `Waiting for video on ${cam.code}`;
      return;
    }

    busy = true;
    statusEl.textContent = `Looking at ${cam.code} ${cam.name}`;
    const started = performance.now();
    try {
      const verdict = await askModel(cam, captureFrame(S.videoFor(camId)));
      lastError = "";
      note.hidden = true;
      addEntry({ camId, ...verdict, seconds: (performance.now() - started) / 1000 });
      if (verdict.status === "emergency") S.alert(camId, verdict.event || "Emergency detected");
    } catch (err) {
      if (err instanceof Offline && llm.sampleWhenOffline !== false) {
        note.hidden = false;
        note.textContent = `${err.message}. Showing sample lines until it connects. Set llm.baseUrl in config.js.`;
        addEntry({ camId, ...sample(camId), sample: true });
      } else if (err.message !== lastError) {
        addEntry({ camId, status: "error", summary: err.message });
      }
      lastError = err.message;
    } finally {
      busy = false;
    }
  }

  // ---------- Log entries ----------

  const TAGS = { normal: "Normal", watch: "Watch", emergency: "Emergency", error: "Problem" };

  function addEntry(entry) {
    const cam = S.camera(entry.camId);
    const li = document.createElement("li");
    li.className = "log-entry";
    li.dataset.status = entry.status;
    if (entry.sample) li.dataset.sample = "";
    const meta = entry.sample
      ? "Sample, not from the AI"
      : entry.seconds != null
        ? `${entry.seconds.toFixed(1)} s on the local AI`
        : "";
    li.innerHTML = `
      <div class="le-head">
        <time>${clock(new Date())}</time>
        <span class="le-cam">${esc(cam.code)} ${esc(cam.name)}</span>
        <span class="le-tag">${entry.sample ? "Sample" : TAGS[entry.status]}</span>
      </div>
      ${entry.event ? `<strong class="le-event">${esc(entry.event)}</strong>` : ""}
      <p>${esc(entry.summary)}</p>
      ${meta ? `<div class="le-meta">${esc(meta)}</div>` : ""}`;
    li.addEventListener("click", () => S.show(entry.camId));
    list.querySelector(".log-empty")?.remove();
    list.prepend(li);
    while (list.children.length > MAX_ENTRIES) list.lastElementChild.remove();
    if (entry.status !== "error") lastStatus = entry.sample ? "sample" : entry.status;
    $("#aiLogDot").dataset.status = lastStatus;
  }

  // ---------- Timing ----------

  function schedule(ms) {
    clearTimeout(timer);
    nextAt = Date.now() + ms;
    timer = setTimeout(run, ms);
  }

  async function run() {
    const started = Date.now();
    if (!document.hidden) await look();
    schedule(Math.max(0, INTERVAL_MS - (Date.now() - started)));
  }

  function tickStatus() {
    if (busy) return;
    const camId = S.currentCamera();
    if (!S.hasVideo(camId)) {
      statusEl.textContent = `Waiting for video on ${S.camera(camId).code}`;
      return;
    }
    const secs = Math.max(0, Math.ceil((nextAt - Date.now()) / 1000));
    statusEl.textContent = `Next look in ${secs} s`;
  }

  // A new camera gets a fresh look straight away.
  window.addEventListener("sentry:camera", () => {
    if (!busy) schedule(800);
  });

  // ---------- Move and minimise ----------

  window.SentryUI.draggable({ panel, handle: $("#aiLog .ailog-head"), key: "sentry.aiLog.position" });
  window.SentryUI.minimisable({
    panel,
    pill,
    minButton: $("#aiLogMin"),
    key: "sentry.aiLog.minimised",
    startMinimised: window.matchMedia("(max-width: 640px)").matches,
  });

  list.innerHTML = `<li class="log-empty">The AI describes the camera on screen every ${INTERVAL_MS / 1000} seconds. Its first look is on the way.</li>`;

  schedule(1500);
  setInterval(tickStatus, 500);
})();
