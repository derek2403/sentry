"""Twilio callbacks only. Calls are started locally through the CLI."""
import json
import os
import re

from flask import Flask, Response, abort, request
from twilio.request_validator import RequestValidator
from twilio.rest import Client
from twilio.twiml.voice_response import VoiceResponse

from .core import database, decision, event, validate_destination
from .scenario import explanation, GUIDANCE, QUESTION, summary
from .script import spoken_intro, spoken_summary

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024


def base_url():
    url = os.getenv("PUBLIC_BASE_URL", "").rstrip("/")
    if not re.fullmatch(r"https://[a-zA-Z0-9.-]+(?::[0-9]+)?", url):
        raise ValueError("PUBLIC_BASE_URL must be an HTTPS origin, without a path.")
    return url


def client():
    return Client(os.environ["TWILIO_ACCOUNT_SID"], os.environ["TWILIO_AUTH_TOKEN"])


def xml(response):
    return Response(str(response), mimetype="application/xml")


def gather(response, run, attempt):
    prompt = response.gather(
        input="dtmf speech", num_digits=1, timeout=7, speech_timeout="auto",
        action=f"{base_url()}/voice/{run}/reply/{attempt}", method="POST",
        action_on_empty_result=True, language="en-US",
    )
    prompt.say(QUESTION, language="en-US")


@app.before_request
def authenticate():
    if not request.path.startswith("/voice/"):
        return
    token = os.getenv("TWILIO_AUTH_TOKEN", "")
    if not token:
        abort(503)
    url = base_url() + request.path
    if request.query_string:
        url += "?" + request.query_string.decode("ascii")
    if not RequestValidator(token).validate(url, request.form, request.headers.get("X-Twilio-Signature", "")):
        abort(403)
    if request.form.get("AccountSid") != os.getenv("TWILIO_ACCOUNT_SID"):
        abort(403)


def owned(db, run, leg="contact"):
    row = db.execute("SELECT * FROM runs WHERE id=?", (run,)).fetchone()
    if not row:
        abort(404)
    if request.form.get("CallSid") != row[f"{leg}_sid"]:
        abort(403)
    return row


def stored_script(row):
    """The Nemotron-written script saved by the `call` command, or None for the fixed scenario."""
    try:
        return json.loads(row["script"]) if row["script"] else None
    except (json.JSONDecodeError, IndexError, KeyError):
        return None


@app.post("/voice/<run>/intro")
def intro(run):
    with database() as db:
        row = owned(db, run)
        event(db, run, "contact_answered_script_requested")
    script = stored_script(row)
    response = VoiceResponse()
    if script:
        response.say(spoken_intro(script), language="en-US")
        response.say(script["guidance"], language="en-US")
    else:
        response.say(explanation(row["occurred_at"]), language="en-US")
        response.say(GUIDANCE, language="en-US")
    gather(response, run, 1)  # the yes/no question is always the fixed one
    return xml(response)


@app.post("/voice/<run>/reply/<int:attempt>")
def reply(run, attempt):
    if attempt not in (1, 2, 3):
        abort(404)
    with database() as db:
        # Serialize callback handling and cache the response for duplicate requests.
        db.execute("BEGIN IMMEDIATE")
        row = owned(db, run)
        cached = db.execute("SELECT xml FROM replies WHERE run=? AND attempt=?", (run, attempt)).fetchone()
        if cached:
            return Response(cached["xml"], mimetype="application/xml")
        if attempt > 1 and not db.execute("SELECT 1 FROM replies WHERE run=? AND attempt=?", (run, attempt - 1)).fetchone():
            abort(409)
        response = VoiceResponse()
        if row["decision"]:
            response.say("This demo decision has already been recorded. Goodbye.")
            response.hangup()
        else:
            result = decision(request.form.get("Digits", ""), request.form.get("SpeechResult", ""), request.form.get("Confidence", ""))
            event(db, run, f"reply_{attempt}_{result}")
            if result in ("unclear", "confirm_yes") and attempt < 3:
                response.say("Please confirm with your keypad. Press 1 for yes or 2 for no.")
                gather(response, run, attempt + 1)
            else:
                final = result if result in ("yes", "no") else "unclear"
                db.execute("UPDATE runs SET decision=? WHERE id=?", (final, run))
                if final == "yes":
                    destination = os.getenv("DEMO_ESCALATION_PHONE", "")
                    if destination:
                        validate_destination(destination)
                        db.execute("UPDATE runs SET escalation_state='claimed' WHERE id=?", (run,))
                        event(db, run, "escalation_authorized")
                        response.say("Your request is recorded. Sentry will attempt the teammate demo call. Goodbye.")
                    else:
                        event(db, run, "consent_recorded_no_escalation_number")
                        response.say("Your request is recorded. No second demo number is configured, so no further call will be made. Goodbye.")
                else:
                    response.say("No escalation call will be made. This demo is complete. Goodbye.")
                response.hangup()
        db.execute("INSERT INTO replies VALUES (?,?,?)", (run, attempt, str(response)))
    # Claim was committed before the external side effect. Never blindly retry it.
    dispatch_escalation(run)
    return xml(response)


def dispatch_escalation(run):
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        changed = db.execute("UPDATE runs SET escalation_state='submitting' WHERE id=? AND escalation_state='claimed'", (run,)).rowcount
        if not changed:
            return
        event(db, run, "demo_escalation_submitting")
        row = db.execute("SELECT occurred_at, script FROM runs WHERE id=?", (run,)).fetchone()
    try:
        destination = validate_destination(os.getenv("DEMO_ESCALATION_PHONE", ""))
        written = stored_script(row)
        twiml = VoiceResponse()
        twiml.say(spoken_summary(written) if written else summary(row["occurred_at"]), language="en-US")
        twiml.hangup()
        call = client().calls.create(
            to=destination, from_=os.environ["TWILIO_FROM_NUMBER"], twiml=str(twiml),
            status_callback=f"{base_url()}/voice/{run}/status/escalation",
            status_callback_event=["completed"], timeout=25,
        )
    except Exception:
        # The provider may have accepted the call before a network timeout.
        with database() as db:
            db.execute("UPDATE runs SET escalation_state='unknown' WHERE id=?", (run,))
            event(db, run, "demo_escalation_submission_unknown_check_provider_console")
        return
    with database() as db:
        db.execute("UPDATE runs SET escalation_sid=?, escalation_state='submitted' WHERE id=?", (call.sid, run))
        event(db, run, "demo_escalation_submitted")


@app.post("/voice/<run>/status/<leg>")
def status(run, leg):
    if leg not in ("contact", "escalation"):
        abort(404)
    state = request.form.get("CallStatus", "")
    if state not in {"completed", "busy", "failed", "no-answer", "canceled"}:
        abort(400)
    with database() as db:
        owned(db, run, leg)
        name = f"{leg}_{state}"
        if not db.execute("SELECT 1 FROM events WHERE run=? AND event=?", (run, name)).fetchone():
            event(db, run, name)
        if leg == "escalation":
            db.execute("UPDATE runs SET escalation_state=? WHERE id=?", (state, run))
    return "", 204
