#!/usr/bin/env node
// A stand-in for the ATOM's vLLM endpoint, for working on the dashboard away from the ATOM.
// It does NOT look at the image: it answers "standing" for the first frames of each
// video, then "fallen". Never use it for the real demo.
//
//   node scripts/mock-nemotron.mjs            # listens on :8000
//   MOCK_FALL_AFTER=8 MOCK_LATENCY_MS=1500 PORT=8001 node scripts/mock-nemotron.mjs

import http from "node:http";

const PORT = Number(process.env.PORT ?? 8000);
const FALL_AFTER = Number(process.env.MOCK_FALL_AFTER ?? 6); // frames
const LATENCY_MS = Number(process.env.MOCK_LATENCY_MS ?? 250); // pretend inference time
const MODEL = "mock-nemotron";

let frame = 0;
let lastRequest = 0;

const standing = { emergency: false, type: "none", person_visible: true, posture: "standing", on_floor: false, confidence: 0.9, description: "An elderly person is standing in the living room." };
const fallen = { emergency: true, type: "fall", person_visible: true, posture: "lying", on_floor: true, confidence: 0.92, description: "An elderly person is lying on the floor beside the sofa after a fall." };

const server = http.createServer((req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (req.method === "GET" && req.url === "/v1/models") {
    return send(200, { object: "list", data: [{ id: MODEL, object: "model" }] });
  }
  if (req.method === "POST" && req.url === "/v1/chat/completions") {
    req.resume();
    req.on("end", () => {
      // A pause of more than 4 s means a new video: start the sequence again.
      if (Date.now() - lastRequest > 4_000) frame = 0;
      lastRequest = Date.now();
      frame += 1;
      const verdict = frame > FALL_AFTER ? fallen : standing;
      setTimeout(() => {
        send(200, {
          id: `mock-${frame}`,
          object: "chat.completion",
          model: MODEL,
          choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(verdict) }, finish_reason: "stop" }],
        });
      }, LATENCY_MS);
    });
    return;
  }
  send(404, { error: "not found" });
});

server.listen(PORT, () => console.log(`mock Nemotron on http://localhost:${PORT}/v1 (fall after ${FALL_AFTER} frames)`));
