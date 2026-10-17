# Sentry

**Local AI that watches over your home.** Sentry turns the cameras you already own into an emergency-detection system. It spots falls, fires, leaks and dangerous situations for children, then sends the home's admin a Telegram message describing what is happening. All video analysis runs on-premises on a GIGABYTE AI TOP ATOM. No video or images ever leave the house, only a short text alert.

> Built for the **ACE 2026 · DGX Spark Mini Hackathon** — *Local AI, Real Problems*.
>
> **Status:** in active development during the hackathon. This README describes the target design. See [Roadmap](#roadmap) for what is built so far.

---

## The problem

Families are busier than ever, so more and more homes rely on CCTV to keep an eye on elderly parents, young children and pets while no one is around. But a camera only records. It doesn't *understand* what it sees:

- **Nobody watches the feed live.** Footage is usually reviewed *after* something has gone wrong.
- **Basic motion alerts are noise.** A curtain moving or a cat walking past triggers the same notification as a real emergency, so people learn to ignore them.
- **Minutes matter.** An elderly person who falls and cannot get up, a kitchen fire, or a burst pipe gets far worse with every minute nobody notices.
- **Cloud "smart camera" AI means streaming your home to someone else's servers.** That includes bedrooms, bathrooms and footage of children, and it comes with a monthly subscription.

**Who it's for:** multi-generational homes, families with young children, and care homes or assisted-living facilities, where one local AI box can cover many existing cameras.

## What Sentry does

Sentry connects to existing IP/RTSP or USB cameras, works out what is happening in each scene, and only sends an alert when something needs attention.

| Who / what   | Emergencies Sentry looks for                                                           | Scope   |
| ------------ | -------------------------------------------------------------------------------------- | ------- |
| 👵 Elderly    | Falls, and a person lying on the floor without moving for a prolonged period          | MVP     |
| 🏠 Home       | Fire and smoke                                                                         | MVP     |
| 🏠 Home       | Water leaks and flooding                                                               | Stretch |
| 🧒 Children   | Climbing furniture or windows, getting close to hazards (stove, balcony, pool)         | Stretch |
| 🐾 Pets       | Pet in distress or in a dangerous area                                                 | Stretch |

When Sentry confirms an emergency, it sends the admin a **text-only** Telegram message. There is no footage and no images, just:

- **what happened, where, and how serious it is**, in plain language,
- **action buttons** so the admin can respond straight from the chat.

```text
🚨 FALL DETECTED · Living room · Severity: HIGH
An elderly person appears to have fallen beside the sofa and has not
moved for about 20 seconds.
[ ✅ They're OK ]   [ 📞 Call emergency contact ]
⏱ No response in 3 minutes → Sentry will call your emergency contact.
```

### Automatic emergency call

If the admin doesn't reply or tap a button **within 3 minutes**, Sentry assumes nobody has seen the alert and **automatically phones the emergency contact**. The emergency contact is a person the household chose, such as a family member or neighbour. On the call, Sentry's voice agent (Nemotron, running on the ATOM):

1. **explains what happened**: what was detected, where, and when;
2. **tells the contact what to do right now**, using a fixed first-aid checklist so it doesn't invent medical advice;
3. **asks: "Do you want me to call emergency services?"** If the contact says yes (or presses 1), Sentry calls emergency services and reads out an incident summary.

```mermaid
flowchart LR
    A["Emergency confirmed"] --> B["Telegram text alert<br/>to admin"]
    B --> C{"Admin responds<br/>within 3 min?"}
    C -->|"They're OK"| D["Close event<br/>logged as resolved"]
    C -->|"Call emergency contact"| E["Call emergency contact<br/>explain + guide"]
    C -->|"No response"| E
    E --> G{"Call emergency<br/>services?"}
    G -->|"Yes"| H["Call emergency services<br/>with incident summary"]
    G -->|"No"| F["Admin updated<br/>on Telegram"]
    H --> F
```

- **They're OK**: the event is closed and no call is made.
- **Call emergency contact**: the call is placed straight away, without waiting the 3 minutes.
- **No response within 3 minutes**: the call is placed automatically. The admin is then told on Telegram that the emergency contact was called.

Sentry only calls public emergency services (999) when the emergency contact confirms it on the call. It never does so on its own.

## How it works

Sentry is a **multi-model pipeline**, not a chatbot. Cheap, fast vision models screen every sampled frame. A local vision-language model (VLM) is called only when something looks wrong, to confirm the event, judge how severe it is and explain it.

```mermaid
flowchart LR
    CAM["Existing cameras<br/>RTSP / IP / USB"] --> SAMPLE

    subgraph ATOM["GIGABYTE AI TOP ATOM · on-premises"]
        SAMPLE["Frame sampler<br/>motion gating"] --> FAST["Fast vision models<br/>person · pose · fire/smoke"]
        FAST -->|candidate event| VLM["Local VLM<br/>scene reasoning + severity"]
        CTX[("Home profile")] -.-> VLM
        VLM -->|structured verdict| MGR["Alert manager<br/>dedupe · cooldown · 3-min timer"]
        MGR --> LOG[("Event log")]
    end

    MGR -->|text alert only| TG["Telegram bot"]
    TG -->|OK / call now| MGR
    MGR -->|no response in 3 min| CALL["Emergency call<br/>to emergency contact"]
```

1. **Capture.** Frames are pulled from each camera stream and sampled at a low rate (about 1 fps). Motion gating skips frames where nothing has changed.
2. **Screen.** Lightweight computer-vision models run on each sampled frame: person detection and pose estimation for falls, plus fire/smoke detection. They are chosen to be light enough to cover several cameras at once.
3. **Reason.** When a screen fires, the frames around it go to the local VLM on the ATOM, along with a short **home profile** (for example, *"Grandma uses a walker and naps on the living-room sofa after lunch"*). The VLM answers the questions a detector can't, such as:
   - *"Is this person lying on the floor or on a bed?"*
   - *"Is this a fire or the stove's normal flame?"*
   - *"Is the child near the open window?"*

   It can ask for a few more seconds of footage before it decides. It returns a structured verdict:

   ```json
   {
     "event": "fall",
     "severity": "high",
     "confidence": 0.91,
     "location": "living room",
     "summary": "Elderly person on the floor beside the sofa, not moving."
   }
   ```

4. **Act.** The alert manager removes duplicate alerts, applies a cooldown, sends the Telegram alert, and starts a 3-minute timer. If the admin doesn't respond in time, it places an automatic call to the emergency contact. Rejected candidates are logged too, which lets us measure false alarms.

**Why two stages?** Running a VLM on every frame from every camera, 24/7, would waste compute and add latency. A VLM is also much better than a detector at telling a real emergency from an everyday look-alike, like someone lying on the sofa or bending to pick something up. Screening first and reasoning second keeps Sentry fast and cuts down false alarms.

## Why it has to run locally

The hackathon asks *"would this run the same without the ATOM?"* For Sentry, it would not:

- **Privacy by design.** Home cameras capture the most private spaces people have: bedrooms, children, elderly parents in vulnerable moments. With Sentry, video is analysed only on the ATOM and is never uploaded. No live footage, clips or snapshots are sent anywhere. The only things that leave the house are a short text alert to the admin's Telegram chat, such as *"Fall detected in the living room"*, and, if nobody responds, a spoken version of the same message on the emergency call. Cloud cameras upload footage around the clock, so this cuts what reaches third parties to a minimum, in line with the data-minimisation principle of Malaysia's PDPA 2010.
- **Continuous analysis is only affordable locally.** Four cameras at 1 fps produce **345,600 frames a day**. Even after gating, sending candidates to a cloud VLM would cost money per call and use upstream bandwidth all the time. On the ATOM, the running cost is effectively the electricity.
- **Why the ATOM, not a Pi or a laptop.** The ATOM has 128 GB of unified memory. That's enough to keep the VLM, the detection and pose models, and several camera streams loaded at the same time. A small edge device can run a detector but not a capable VLM. A laptop can't stay on 24/7 as a home appliance.
- **Latency.** Inference happens on the same LAN as the cameras, with no upload round-trip.
- **Uses the cameras people already own.** There are no new cameras to buy and no cloud subscription. One local AI box serves the whole home.

> **Honest limitation:** detection keeps running if the internet drops, but Telegram delivery and the emergency call both need a connection. During an outage, events are logged locally and the alert is retried. A local alarm (speaker or LAN page) is on the roadmap.

## Tech stack

| Layer             | Choice                                                                      |
| ----------------- | --------------------------------------------------------------------------- |
| Hardware          | GIGABYTE AI TOP ATOM (NVIDIA DGX Spark platform, ARM64)                     |
| LLM / VLM serving | vLLM: the OpenAI-compatible endpoint already configured on the ATOM          |
| Computer vision   | OpenCV for stream capture, plus lightweight person/pose and fire/smoke models |
| Alerting          | Telegram Bot API (long polling, so no public webhook is needed)             |
| Emergency calls   | Voice-call API (e.g. Twilio) with a text-to-speech message                  |
| Language          | Python                                                                      |

> **Model notes**
> - The workshop's baseline model is NVIDIA Nemotron 3.5 Lightning. The exact served model ID, and whether it accepts **image input**, is still to be confirmed with the organisers. Check `/v1/models` (below) and set `LLM_MODEL` in `.env`.
> - If the served model is text-only, the Reason step falls back to sending the detector outputs as structured text: labels, boxes, pose keypoints and timings. We will not start a second inference service to get a VLM without organiser approval.
> - Computer-vision model weights are used only after organiser approval. They are stored under `models/` so nothing downloads at runtime.

## Getting started

> Setup and run steps describe the target layout. They will work once the corresponding files are committed (see [Roadmap](#roadmap)).
>
> Run Sentry on your team's assigned ATOM, using the inference service that is already running there. Do not start a second vLLM process or download extra models without approval from the organisers.

### Prerequisites

- Access to your team's assigned ATOM, via NVIDIA Sync → Terminal / VS Code
- Python 3.10+
- A Telegram bot token from [@BotFather](https://t.me/BotFather). Every recipient must send the bot a message first; then read each `chat.id` from `https://api.telegram.org/bot<token>/getUpdates`.
- At least one camera source: an RTSP URL, a USB webcam, or a recorded video file for demos

The ATOM is ARM64, so install aarch64-compatible builds of any CV libraries. The vLLM service already uses most of the shared GPU memory, so keep CV models small and check headroom with `nvidia-smi` first.

### Setup

```bash
git clone <this-repo-url> sentry
cd sentry
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # then fill in the values below
```

### Configuration (`.env`)

```dotenv
# Local inference endpoint on the ATOM (OpenAI-compatible)
LLM_BASE_URL=http://localhost:8000/v1
LLM_MODEL=<served-model-id>
LLM_API_KEY=                     # leave blank if the endpoint has no key

# Telegram
TELEGRAM_BOT_TOKEN=<your-bot-token>
TELEGRAM_CHAT_ID=<admin-chat-id>

# Automatic emergency call
ACK_TIMEOUT_SECONDS=180                       # call the emergency contact if the admin doesn't respond within 3 minutes
EMERGENCY_CONTACT_PHONE=<+60XXXXXXXXX>
VOICE_API_SID=<voice-provider-account-id>
VOICE_API_TOKEN=<voice-provider-token>
VOICE_FROM_NUMBER=<caller-id-number>

# Cameras: comma-separated "name=source" pairs (RTSP URL, device index, or video file).
# RTSP URLs often contain the camera's username/password, so keep them only in .env.
CAMERAS=living_room=rtsp://<camera-ip>/stream,kitchen=0,demo=samples/fall_demo.mp4

# Local data retention for the event log on the ATOM
RETENTION_DAYS=7
```

Never commit `.env`, event logs or recordings. Add them to `.gitignore`.

### Verify the local model

```bash
nvidia-smi                                                   # GPU is visible
curl -s http://localhost:8000/v1/models | python3 -m json.tool   # endpoint is up; note the model "id"
```

Use the host and port the organisers gave you if they differ from vLLM's default `localhost:8000`. If the endpoint requires a key, add `-H "Authorization: Bearer <key>"`.

### Run

```bash
python3 -m sentry
```

## Demo

Our 5-minute demo shows an elderly fall handled end to end on the ATOM. **See [demo.md](demo.md) for the full script.**

1. The Sentry dashboard shows the home's camera feed.
2. We upload a video of an elderly person falling, which plays as a camera source.
3. Nemotron confirms the fall. Sentry calls the emergency contact, explains what happened and what to do, then asks whether to call emergency services.

During the demo, the "emergency contact" and "emergency services" are both teammates' phones. No real emergency number is ever dialled. All demo footage is staged by the team or synthetic. Any third-party clips are used only with organiser approval and a compatible licence. No real household footage is used.

## Results

*To be filled in from measurements on the ATOM.*

| Metric                                         | Value |
| ---------------------------------------------- | ----- |
| End-to-end latency (event confirmed → Telegram) | _TBD_ |
| VLM latency per verdict                        | _TBD_ |
| Cameras handled at the same time               | _TBD_ |
| Staged test clips: true alarms caught           | _TBD_ |
| Staged test clips: false alarms rejected by VLM | _TBD_ |

## How Sentry maps to the judging criteria

| Criterion                | Weight | Where to look                                                                                       |
| ------------------------ | :----: | --------------------------------------------------------------------------------------------------- |
| AI capability            | 25%    | [How it works](#how-it-works): CV screening → VLM reasoning with home context → Telegram alert → automatic emergency call |
| Local AI on the ATOM     | 25%    | [Why it has to run locally](#why-it-has-to-run-locally); [demo.md](demo.md) step 6                    |
| Impact & feasibility     | 20%    | [The problem](#the-problem): reuses existing cameras, no subscription, privacy-preserving           |
| Technical implementation | 15%    | [Demo](#demo) and [Results](#results)                                                               |
| Pitch & demo             | 15%    | [demo.md](demo.md): live elderly-fall scenario from dashboard to emergency call                     |

## Roadmap

- [ ] Camera ingestion and frame sampling
- [ ] Fall detection (person + pose) and fire/smoke screening
- [ ] VLM verification with structured verdicts and home profile
- [ ] Text-only Telegram alerts with action buttons
- [ ] Acknowledgement tracking with a 3-minute timeout
- [ ] Automatic emergency call to the emergency contact
- [ ] Voice agent on the call: explain, guide from the first-aid checklist, offer to call emergency services
- [ ] Dashboard with camera view and video upload for demos
- [ ] Event log with rejected candidates
- [ ] Water leak and child-safety scenarios
- [ ] Local alarm when the internet is down
- [ ] Local event-log dashboard (LAN-only, password-protected)
- [ ] Audio cues (calls for help, smoke alarms) via local speech-to-text
- [ ] Per-camera danger zones (stove, balcony, pool) and privacy zones

## Limitations & responsible use

- Sentry **supports** human caregivers. It is **not** a certified safety or medical device, and it does not replace smoke detectors, emergency services or professional care.
- Like any vision system, it can miss events (poor lighting, the person outside the camera's view) and can raise false alarms. Alerts describe what Sentry saw, so the admin can check in (for example by calling home or opening their existing CCTV app) and make the final call.
- **Consent.** Get consent from the adults being monitored, including elderly parents, and respect their right to refuse. Tell carers, domestic helpers and regular visitors. Don't put cameras in bathrooms.
- **Data handling.** Sentry does not record continuously, and no footage or images are sent off the ATOM. Only event verdicts are kept in the local event log, and they are deleted after `RETENTION_DAYS`. Text alerts already delivered to Telegram must be deleted there separately.
- **Emergency contact.** The emergency contact must agree to receive automatic calls. Keep their number up to date, because Sentry relies on it when the admin doesn't respond.
- **Access control.** The bot sends alerts to, and accepts button presses from, an allow-list of chat IDs only. Use a private chat, or a small group with only the people who should see these alerts.

## Team

| Name | Role |
| ---- | ---- |
| _TBD_ | _ATOM / AI pipeline_ |
| _TBD_ | _Computer vision_ |
| _TBD_ | _Telegram & alerting_ |
| _TBD_ | _Frontend / dashboard_ |
| _TBD_ | _Testing, docs & pitch_ |

## Acknowledgements

Built at **ACE 2026 · DGX Spark Mini Hackathon** on a GIGABYTE AI TOP ATOM, with thanks to NVIDIA, GIGABYTE and EMARQUE for the hardware, local inference setup and support.
