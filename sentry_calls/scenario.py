"""Edit these fictional facts for the demo; no incident input API is needed."""

from datetime import datetime
from zoneinfo import ZoneInfo


def malaysia_time(occurred_at=None):
    moment = datetime.fromisoformat(occurred_at) if occurred_at else datetime.now(ZoneInfo("Asia/Kuala_Lumpur"))
    local = moment.astimezone(ZoneInfo("Asia/Kuala_Lumpur"))
    return local.strftime("%I:%M %p").lstrip("0").lower() + " Malaysia time"


HOUSEHOLD = "Tan family demo home"
ADDRESS = "Demo address, to be configured"
INCIDENT = "A person appears to have fallen beside the living room sofa and has not got up."


def explanation(occurred_at=None):
    return (
        f"Hello, this is a Sentry home safety demonstration for the {HOUSEHOLD}. "
        f"At {malaysia_time(occurred_at)}, {INCIDENT} "
        "In this staged scenario, the household admin has not responded to the alert."
    )


# Copied from demo.md. Demo script only; requires review before production use.
GUIDANCE = (
    "Here is what to do right now. "
    "If you can, go to the person or call someone nearby who can. "
    "Do not try to lift them if they may be hurt, especially if they have pain in the hip, back or head. "
    "Check whether they are awake and breathing. "
    "Keep them warm and comfortable until help arrives."
)
QUESTION = (
    "Do you want me to call emergency services? "
    "For this demo, that means a second teammate, never a real emergency number. "
    "Say yes or no, or press 1 for yes and 2 for no."
)


def summary(occurred_at=None):
    return (
        "This is an automated Sentry demonstration, not a real emergency request. "
        f"At {malaysia_time(occurred_at)}, {INCIDENT} The demo location is {ADDRESS}. "
        "The emergency contact explicitly requested this demo escalation call."
    )
