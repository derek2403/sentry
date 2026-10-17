import argparse
import json
import os
import uuid
from datetime import datetime, timezone

from dotenv import load_dotenv

from .core import database, decision, event, validate_destination
from .scenario import explanation, GUIDANCE, QUESTION, summary
from .script import generate, spoken_intro, spoken_summary


def incident_script(raw):
    """Script for --incident (JSON from Sentry), written by Nemotron; None without an incident."""
    if not raw:
        return None
    try:
        incident = json.loads(raw)
    except json.JSONDecodeError:
        raise ValueError("--incident must be JSON") from None
    script = generate(incident)
    # One machine-readable line so Sentry can show the script in its AI log.
    print("script: " + json.dumps(script))
    return script


def main():
    load_dotenv()
    parser = argparse.ArgumentParser(description="Sentry phone call demo.")
    parser.add_argument("command", choices=["simulate", "serve", "call", "history"])
    parser.add_argument("--reply", default="yes", choices=["yes", "no", "unclear"], help="Simulation reply; no interactive input required")
    parser.add_argument("--incident", help='JSON from Sentry: {"type", "description", "location", "detected_at"}; Nemotron writes the call from it')
    args = parser.parse_args()
    if args.command == "simulate":
        try:
            script = incident_script(args.incident)
        except ValueError as error:
            parser.exit(2, f"{error}\n")
        print("SIMULATION ONLY — no phone call" + (f" (script: {script['source']})" if script else ", no AI requests") + "\n")
        intro, guidance = (spoken_intro(script), script["guidance"]) if script else (explanation(), GUIDANCE)
        print(intro, "\n\n", guidance, "\n\n", QUESTION, sep="")
        result = decision(digits={"yes": "1", "no": "2", "unclear": "9"}[args.reply])
        print(f"\nSimulated recipient: {args.reply}")
        if result == "yes":
            print("\nSIMULATED second call (only if a teammate number is configured):\n" + (spoken_summary(script) if script else summary()))
        else:
            print("No second call. Unclear replies get at most three attempts in connected mode.")
        return
    if args.command == "history":
        with database() as db:
            for row in db.execute("SELECT run,at,event FROM events ORDER BY id"):
                print(" | ".join(row))
        return
    from .app import app, base_url, client
    try:
        base_url()
        for name in ("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"):
            if not os.getenv(name):
                raise ValueError(f"Missing {name}; fill in .env first.")
        if args.command == "serve":
            app.run(host="127.0.0.1", port=5050, debug=False)
            return
        contact = validate_destination(os.getenv("EMERGENCY_CONTACT_PHONE", ""))
        if os.getenv("DEMO_ESCALATION_PHONE"):
            validate_destination(os.environ["DEMO_ESCALATION_PHONE"])
        script = incident_script(args.incident)  # written before dialling, so the call never waits on the model
        run = uuid.uuid4().hex
        with database() as db:
            db.execute(
                "INSERT INTO runs(id,occurred_at,script) VALUES (?,?,?)",
                (run, datetime.now(timezone.utc).isoformat(), json.dumps(script) if script else None),
            )
            event(db, run, f"script_{script['source']}" if script else "script_fixed")
            event(db, run, "contact_submitting")
        try:
            call = client().calls.create(
                to=contact, from_=os.environ["TWILIO_FROM_NUMBER"],
                url=f"{base_url()}/voice/{run}/intro", method="POST",
                status_callback=f"{base_url()}/voice/{run}/status/contact",
                status_callback_event=["completed"], timeout=25,
            )
        except Exception:
            with database() as db:
                event(db, run, "contact_submission_unknown_check_provider_console")
            raise ValueError("Call submission failed or is uncertain. Check the Twilio console before running call again.") from None
        with database() as db:
            db.execute("UPDATE runs SET contact_sid=? WHERE id=?", (call.sid, run))
            event(db, run, "contact_submitted")
        print(f"Demo contact call submitted. Run: {run}")
    except ValueError as error:
        parser.exit(2, f"{error}\n")


if __name__ == "__main__":
    main()
