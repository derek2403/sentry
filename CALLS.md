# Sentry hardcoded call demo

This standalone slice implements the phone scenario from demo.md. No cameras,
Telegram, dashboard, incident input API, or acknowledgement timer are needed.
The fictional household, incident, fixed checklist, and spoken summary live in
`sentry_calls/scenario.py`. Phone numbers can be supplied later in `.env`.

## Setup and simulation

```sh
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-calls.txt
cp .env.example .env
python -m sentry_calls simulate
python -m sentry_calls simulate --reply no
python -m sentry_calls simulate --reply unclear
```

Simulation prints the script and a hardcoded reply. It does not call anyone,
contact Nemotron, or play audio. No credentials or phone numbers are required.

## Real demo calls

Use consenting teammates' phones only. Add to `.env`:

- `EMERGENCY_CONTACT_PHONE`: first teammate, in `+60...` format.
- `DEMO_ESCALATION_PHONE`: optional second teammate; leave blank to end after consent.
- `APPROVED_DEMO_NUMBERS`: comma-separated full international teammate numbers.
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`: your voice account and voice-enabled caller number.
- `PUBLIC_BASE_URL`: public HTTPS tunnel origin forwarding to port 5050.

The allow-list and international-number validation exclude short emergency
numbers such as 999 and 112. Only add test phones you control. Trial accounts
may require verifying recipients and enabling destination-country permissions.

Start your HTTPS tunnel using your preferred tool, set its origin in `.env`, then:

```sh
# Terminal 1: leave running; expose this through the tunnel
python -m sentry_calls serve
# Terminal 2: starts ONE actual contact call immediately
python -m sentry_calls call
# Inspect local timestamped history
python -m sentry_calls history
```

There is no public start-call endpoint and the server does not call on startup.
Twilio fetches the spoken script and posts speech/keypad replies to signed
callbacks. The first call explains the staged incident, reads the demo.md
checklist, and asks for yes/no. Press 1 for yes, 2 for no. Silence/unclear replies
get up to three attempts. Yes triggers the second teammate call if configured;
no or exhausted unclear replies end the conversation without escalation.

## Nemotron on DGX Spark

Use the existing OpenAI-compatible inference service on your assigned Spark.
Set `LLM_BASE_URL` to its base URL including `/v1`, and `LLM_MODEL` to the exact
served model ID. Leave `LLM_API_KEY` blank if the service requires no key.
Do not start another inference service or download models for this demo.

For example, after replacing the host and port with the assigned values:

```sh
curl http://<spark-lan-ip>:8000/v1/models
```

The computer running the call service must be able to reach that address.
`localhost` works only when both services run on the same computer.
The Spark inference endpoint does not need a public tunnel; keep it on the LAN.
Twilio needs public access only to the signed call-service callbacks.

Clear high-confidence yes/no speech and keypad responses work without AI.
Longer speech is classified by Nemotron using a JSON-only prompt and validated
response. An AI-interpreted yes requires further confirmation. Missing/low
speech confidence, invalid JSON, or an inference error leads to clarification.
Scripts and guidance stay fixed; the model cannot choose phone numbers or invent
medical advice. Blank endpoint/model settings disable AI classification.

Reply reasoning runs on your Spark. Twilio still performs speech recognition and
text-to-speech and receives spoken incident text; the complete phone pipeline is
not entirely local. This implementation uses Gather, not ConversationRelay.

## Limits and troubleshooting

- No real emergency-services integration exists. The second call is a demo.
- The checklist is copied from demo.md and needs review before production use.
- SQLite stores consent, provider call IDs and timestamped events under ignored
  `data/`; raw transcripts/audio are not stored by this app. Provider retention
  is managed separately. Delete the local database when demo history is no longer needed.
- Callback signatures and account/call identity are verified. A 403 usually means
  the public origin differs from `PUBLIC_BASE_URL` or credentials do not match.
- Keep the server/tunnel running through both calls. Do not use Flask debug reload.
- Repeated callbacks are cached and escalation submissions are claimed once.
  Calls are not automatically retried after an ambiguous provider error or crash;
  inspect `history` and the Twilio console before manually starting another run.
- Each explicit `call` command creates a new demo run. Do not run it repeatedly
  to recover an uncertain submission without checking the provider console.
- A crash between consent and submission may leave an escalation pending; this
  prototype has no recovery worker, no delivery guarantee, and no cancellation API.
- A provider `completed` status means the call ended, not that someone is safe or
  even that a human heard it. No voicemail detection is implemented.
- Late callbacks that arrive before the initial provider ID has been saved can
  be rejected. For this prototype, inspect the provider console if that occurs.

## Verification

```sh
python -m unittest discover -s tests -v
```

Implementation references: [Twilio Gather](https://www.twilio.com/docs/voice/twiml/gather),
[outbound calls](https://www.twilio.com/docs/voice/api/call-resource),
[signature validation](https://www.twilio.com/docs/usage/tutorials/how-to-secure-your-flask-app-by-validating-incoming-twilio-requests).
