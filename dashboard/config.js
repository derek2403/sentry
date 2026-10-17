// Sentry dashboard configuration.
//
// Each camera's `src` is the video shown when its CAM button is clicked.
// Save clips into the `videos/` folder with these names (or change the paths),
// or drag a video onto the screen to play it on the current camera.
//
// A camera with `source: "webcam"` uses this computer's camera instead of a
// file. The browser asks for permission the first time it is shown.
//
// The map is a 640 × 430 canvas:
//   rooms        outlines drawn on the map
//   chip.x/y     top-left corner of the camera's "CAM" button

window.SENTRY_CONFIG = {
  // The AI that describes what each camera sees (the AI log on the left).
  // Point baseUrl at the vLLM endpoint on the ATOM, e.g. http://192.168.1.50:8000/v1.
  // Camera frames are sent only to this address, so keep it on your home network.
  llm: {
    baseUrl: "http://localhost:8000/v1",
    model: "", // blank = use the first model the endpoint serves
    apiKey: "", // blank if the endpoint has no key
    intervalSeconds: 10,
    sampleWhenOffline: true, // show labelled sample lines until the AI is reachable
  },

  rooms: [
    { id: "kitchen", name: "Kitchen", x: 20, y: 20, w: 170, h: 150 },
    { id: "dining", name: "Dining", x: 190, y: 20, w: 140, h: 150 },
    { id: "kids", name: "Kids' room", x: 330, y: 20, w: 170, h: 150 },
    { id: "grandma", name: "Grandma's room", x: 20, y: 170, w: 150, h: 190 },
    { id: "living", name: "Living room", x: 170, y: 170, w: 230, h: 190 },
    { id: "study", name: "Study", x: 400, y: 170, w: 100, h: 90 },
    { id: "garage", name: "Garage", x: 400, y: 260, w: 100, h: 100 },
    { id: "porch", name: "Porch", x: 230, y: 360, w: 110, h: 50 },
    { id: "garden", name: "Garden", x: 500, y: 20, w: 120, h: 390 },
  ],

  // Where the AI box sits. Shown on the map the way FNAF shows "YOU".
  atom: { x: 424, y: 184 },

  cameras: [
    { id: "pc", code: "5", name: "This PC", source: "webcam", chip: { x: 30, y: 368 } },
    { id: "living", code: "1A", name: "Living room", src: "videos/living.mp4", chip: { x: 256, y: 240 } },
    { id: "dining", code: "1B", name: "Dining", src: "videos/dining.mp4", chip: { x: 230, y: 70 } },
    { id: "kitchen", code: "1C", name: "Kitchen", src: "videos/kitchen.mp4", chip: { x: 75, y: 70 } },
    { id: "grandma", code: "2A", name: "Grandma's room", src: "videos/grandma.mp4", chip: { x: 65, y: 240 } },
    { id: "kids", code: "2B", name: "Kids' room", src: "videos/kids.mp4", chip: { x: 385, y: 70 } },
    { id: "frontdoor", code: "3A", name: "Front door", src: "videos/frontdoor.mp4", chip: { x: 350, y: 368 } },
    { id: "garage", code: "3B", name: "Garage", src: "videos/garage.mp4", chip: { x: 417, y: 280 } },
    { id: "garden", code: "4A", name: "Garden", src: "videos/garden.mp4", chip: { x: 527, y: 300 } },
    { id: "pool", code: "4B", name: "Pool", src: "videos/pool.mp4", chip: { x: 527, y: 80 } },
  ],
};
