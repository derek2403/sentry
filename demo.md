# Sentry: Demo

This is what we show in our 5-minute pitch: an elderly person falls on camera, and Sentry handles the whole emergency, from detection to a phone call with guidance, using **Nemotron models running locally on the GIGABYTE AI TOP ATOM**.

> ⚠️ **Demo safety:** no real emergency number is ever dialled during the demo. The "emergency contact" and "emergency services" are both teammates' phones.

---

## The scenario at a glance

1. **The dashboard** shows the camera feed for a home.
2. **We upload a video** of an elderly person falling, which plays as a camera source.
3. **Sentry detects the fall** and starts the emergency workflow:
   - it **calls the emergency contact**,
   - **tells them what happened**,
   - **tells them what to do** right now,
   - and finally asks: ***"Do you want me to call emergency services?"***

```mermaid
sequenceDiagram
    autonumber
    participant Cam as Dashboard / camera feed
    participant Atom as Sentry on ATOM (Nemotron)
    participant Admin as Admin (Telegram)
    participant Contact as Emergency contact (phone)
    participant ES as Emergency services (teammate)

    Cam->>Atom: Uploaded fall video plays as a camera stream
    Atom->>Atom: Vision screen flags a possible fall
    Atom->>Atom: Nemotron confirms the fall and writes a structured verdict
    Atom->>Admin: Text alert: "Fall detected in the living room"
    Note over Admin: Left unanswered. Timeout shortened from 3 min for the demo
    Atom->>Contact: Automatic phone call
    Atom->>Contact: What happened
    Atom->>Contact: What to do now
    Atom->>Contact: "Do you want me to call emergency services?"
    Contact->>Atom: "Yes" (or press 1)
    Atom->>ES: Call with incident summary
    Atom->>Cam: Dashboard timeline: event closed, all steps logged
```

## Where the Nemotron models are used

Every AI step runs on the ATOM through the local inference endpoint. No cloud LLM is used.

| Step                  | What the model does                                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Verify the fall**   | Looks at the frames around the flagged moment and decides whether it's a real fall (not someone sitting or lying on a sofa). Returns event, severity, confidence and a one-line summary. |
| **Explain**           | Turns the verdict into a short, calm spoken message for the emergency contact: what happened, where, and when.        |
| **Guide**             | Gives step-by-step guidance on what to do now. The guidance is grounded in a fixed first-aid checklist for falls, so the model selects and phrases steps from the checklist rather than inventing medical advice. |
| **Understand the reply** | Interprets the contact's answer to "Do you want me to call emergency services?" (yes / no / unclear → ask again).     |
| **Brief emergency services** | Writes the summary read out on the second call: what happened, when, the address, and whether the contact is on the way. |

> The exact Nemotron model IDs served on our ATOM, and whether the served model takes image input, are confirmed with the organisers. We fill them in here: Vision: `<model-id>` · Conversation: `<model-id>`.

## Cast and setup

| Role                       | Who / what                                                                       |
| -------------------------- | -------------------------------------------------------------------------------- |
| Presenter                  | Drives the dashboard and narrates                                                |
| Admin                      | A team member's Telegram account. Receives the text alert and leaves it unanswered |
| Emergency contact          | A team member's phone, on speaker so the judges can hear the call                |
| "Emergency services"       | A second team member's phone. **Never a real emergency number.**                 |
| ATOM                       | Runs Sentry and the Nemotron models. `nvidia-smi` is open in a terminal on screen |

Demo video: a staged or synthetic clip of an elderly person falling (no real household footage).

## Step-by-step script

### 1. The dashboard (≈ 30 s)

**On screen:** the Sentry dashboard showing the camera feed for the "living room", the event timeline (empty) and the workflow panel (idle).

**Say:** *"This is Sentry. It connects to the CCTV cameras a family already has. Everything you're about to see is analysed on this ATOM, and no video leaves the house."*

### 2. Upload the fall video (≈ 15 s)

**On screen:** click **Upload video** and choose the fall clip. It starts playing in the camera view as if it were the live feed.

**Say:** *"For the demo, we'll play a staged clip of an elderly person at home, standing in for the live camera."*

### 3. The fall is detected (≈ 30 s)

**On screen:**
- the person in the clip falls,
- the camera view highlights the person and shows **"Possible fall"**,
- the workflow panel shows **Nemotron verifying…**, then the verdict:

```json
{
  "event": "fall",
  "severity": "high",
  "confidence": 0.91,
  "location": "living room",
  "summary": "Elderly person fell beside the sofa and is not getting up."
}
```

- the admin's phone receives the Telegram text alert. Nobody answers it.

**Say:** *"A fast vision model flagged a possible fall, and Nemotron confirmed it's real, not someone lying down on purpose. The admin gets a text alert, but in real life they might be in a meeting. Normally Sentry waits 3 minutes; for the demo we've shortened that."*

### 4. Sentry calls the emergency contact (≈ 1 min 30 s)

**On screen:** the workflow panel moves to **Calling emergency contact**, and the contact's phone rings. Put it on speaker.

**The call:** the text below is an example. Nemotron generates it from the verdict and the first-aid checklist.

> **Sentry:** "Hello, this is Sentry, the home safety system at the Tan family home. At 2:41 pm, Mdm. Tan appears to have **fallen in the living room** beside the sofa, and she has not got up. The household admin has not responded to the alert."
>
> **Sentry:** "Here is what to do right now:
> 1. If you can, go to her or call someone nearby who can.
> 2. Do not try to lift her if she may be hurt, especially if she has pain in the hip, back or head.
> 3. Check whether she is awake and breathing.
> 4. Keep her warm and comfortable until help arrives."
>
> **Sentry:** "**Do you want me to call emergency services?** Say yes or no, or press 1 for yes."

**Say:** *"Sentry didn't just send a notification. It called a real person, explained the situation and told them what to do, all generated locally by Nemotron."*

### 5. "Yes, call emergency services" (≈ 45 s)

**On screen:** the contact answers **"Yes."** The workflow panel moves to **Calling emergency services**, and the second teammate's phone rings.

> **Sentry:** "This is an automated call from Sentry, a home safety system. An elderly woman has fallen at *[demo address]* at 2:41 pm and has not got up. Her emergency contact has been informed and asked for help to be sent."

The workflow panel then shows **Completed**, and the event timeline lists every step with timestamps:
- detected
- verified
- admin alerted
- contact called
- guidance given
- emergency services called

If the contact answers **"No"**, Sentry doesn't make the second call. It logs the answer and sends the admin an update on Telegram.

### 6. Prove it's local (≈ 15 s)

**On screen:** switch to the ATOM terminal and show `nvidia-smi` and the inference request log, which were active during the call.

**Say:** *"Every model call you just saw ran on this ATOM. The only things that left the house were a text message and two phone calls."*

## What runs locally vs. what leaves the house

| Runs on the ATOM                                         | Leaves the house                                      |
| -------------------------------------------------------- | ----------------------------------------------------- |
| Video decoding and frame sampling                        | Telegram text alert to the admin (no images)          |
| Vision screening and Nemotron fall verification          | Voice calls to the emergency contact and "emergency services" (spoken text only) |
| Generating the call script, guidance and reply understanding | Nothing else. No video, clips or snapshots           |
| Event log and dashboard                                  |                                                       |

## Pre-demo checklist

- [ ] The local inference endpoint is up, and the Nemotron model IDs are confirmed (`/v1/models`)
- [ ] The demo timeout is set to a few seconds (`ACK_TIMEOUT_SECONDS`), not 180
- [ ] `EMERGENCY_CONTACT_PHONE` and the "emergency services" number are **both teammates' phones**
- [ ] The phones are charged, unmuted and off silent, and the emergency contact's phone is ready for speaker
- [ ] The fall clip is loaded on the dashboard machine
- [ ] The Telegram bot has been started by the admin account
- [ ] The `nvidia-smi` terminal is open in a second window
- [ ] A dry run has been done end to end at least once
- [ ] **Backup:** a screen recording of a successful run, in case the venue network or a phone call fails
