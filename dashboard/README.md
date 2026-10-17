# Sentry dashboard

A single camera screen, FNAF style: the selected camera fills the screen, and a map in the corner has a `CAM` button for every camera. Click a button to switch to that camera. Plain HTML, CSS and JavaScript. No build step and no internet connection needed.

## Run

```bash
python3 -m http.server 8080 -d dashboard
# then open http://localhost:8080 (or http://<atom-ip>:8080 from another device)
```

## Add videos

- **Permanent:** save clips into `videos/` using the names in [videos/README.md](videos/README.md), or change each camera's `src` in [config.js](config.js). Refresh the page.
- **Quick:** drag a video onto the screen to play it on the current camera. It plays from your disk and is gone on reload.

A dashed `CAM` button means that camera has no video yet.

## This PC's camera

`CAM 5` ("This PC") uses your webcam. The browser asks for permission the first time it's shown; video stays on this computer. If you blocked it, click the camera icon in the address bar, allow access, and press **Try again**.

Browsers only allow cameras on `https` or `localhost`, so open the dashboard at `http://localhost:8080` on the PC with the webcam.

## Looking around

Move the cursor and the view follows it: left and right, up and down. The picture is zoomed in a little so there is room to look around. Webcams with pan/tilt motors (some PTZ webcams) turn for real instead; Chrome asks a second permission for camera movement. The zoom and speed are `PAN_ZOOM` and `PAN_EASE` at the top of [app.js](app.js).

## Cameras and map

Rooms, cameras and where each `CAM` button sits on the map are in [config.js](config.js). The map is a 640 × 430 canvas.

## AI log

The panel on the left shows what the local AI sees on the camera on screen. Every 10 seconds the dashboard sends one frame from that camera to the AI and adds its answer: a short description and a Normal, Watch or Emergency tag. An Emergency also flashes that camera red on the map; press **Mark OK** to clear it. Switching camera triggers a fresh look straight away.

## Arranging the screen

- **Move the AI log:** drag its header. Drag the bottom-right corner to resize it. Double-click the header to put it back.
- **Minimise:** the **–** button on the AI log or the map shrinks it to a small button; click that button to bring it back. The map's button shows the current camera and turns red if any camera is in alert.

The dashboard remembers the layout in this browser.

Set the AI's address in `llm` in [config.js](config.js). It must be the vLLM endpoint on the ATOM (an OpenAI-compatible `/v1` URL with a model that accepts images), so frames never leave your home network. Until that address answers, the log shows sample lines marked **Sample** and a yellow note saying the AI isn't connected.

The browser calls the endpoint directly, so it must allow cross-origin requests. vLLM allows all origins by default (`--allowed-origins`).

## Connecting the Sentry backend

```js
Sentry.alert("kitchen", "Smoke near the stove"); // that camera's button flashes red
Sentry.show("kitchen");                          // switch to that camera
Sentry.clear("kitchen");                         // stop flashing
```
