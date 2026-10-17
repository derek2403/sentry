"""Call script written by Nemotron from the detected incident, inside fixed safety framing.

Nemotron writes three parts in plain spoken English:
  intro     what Sentry detected, where and when
  guidance  what to do now, chosen and rephrased ONLY from the fixed checklist for that type
  summary   what to tell the second (escalation) call

The parts that matter for safety stay fixed and never come from the model: the opening
("this is a Sentry home safety demonstration"), the yes/no question, the disclaimer on the
escalation call, and the phone numbers. If Nemotron is unavailable or returns anything
unusable, a fixed script for the incident type is used instead, so a call always works.

Checklists are demo content and need review before production use.
"""
import json
import os
import re

import httpx

from .scenario import ADDRESS, HOUSEHOLD, malaysia_time

LABELS = {
    "fall": "a fall",
    "fire_smoke": "fire or smoke",
    "water_leak": "a water leak",
    "medical": "a medical emergency",
    "child_danger": "a child in danger",
    "intruder": "a possible intruder",
    "other": "an emergency",
}

CHECKLISTS = {
    # The fall steps are the ones from demo.md.
    "fall": [
        "If you can, go to the person or call someone nearby who can.",
        "Do not try to lift them if they may be hurt, especially if they have pain in the hip, back or head.",
        "Check whether they are awake and breathing.",
        "Keep them warm and comfortable until help arrives.",
    ],
    "fire_smoke": [
        "If anyone is at home, they should leave the house straight away and close doors behind them.",
        "Do not go back inside for belongings.",
        "Do not use water on an oil or electrical fire.",
        "Once everyone is out, call the fire brigade.",
    ],
    "water_leak": [
        "If someone is at home, they should turn off the main water valve.",
        "Only switch off the electricity if the switch can be reached without touching water.",
        "Keep people and pets away from the water.",
    ],
    "medical": [
        "If you can, go to the person or call someone nearby who can.",
        "Check whether they are awake and breathing.",
        "Do not give them food, drink or medicine.",
        "Stay with them and keep them calm until help arrives.",
    ],
    "child_danger": [
        "Get someone to the child straight away.",
        "Call to the child calmly, without startling them.",
        "Move the child away from the danger, such as the window, stove or pool.",
        "Stay with the child until they are safe.",
    ],
    "intruder": [
        "Do not go to the house alone.",
        "If someone is at home, they should go to a room that locks and stay there.",
        "Call the police.",
    ],
    "other": [
        "Check on the household straight away, or ask someone nearby to.",
        "Do not put yourself in danger.",
        "Get help if anyone is hurt or at risk.",
    ],
}

GUIDANCE_START = "Here is what to do right now."
MAX_LENGTH = {"intro": 400, "guidance": 600, "summary": 400}
SCHEMA = {
    "type": "object",
    "properties": {"intro": {"type": "string"}, "guidance": {"type": "string"}, "summary": {"type": "string"}},
    "required": ["intro", "guidance", "summary"],
    "additionalProperties": False,
}


def normalise_incident(raw):
    """Keep only the fields we use, with safe types and lengths. `raw` comes from Sentry."""
    if not isinstance(raw, dict):
        raise ValueError("incident must be a JSON object")
    kind = raw.get("type") if raw.get("type") in LABELS else "other"
    text = lambda key, limit: clean(str(raw.get(key) or ""))[:limit]
    return {
        "type": kind,
        "description": text("description", 300),
        "location": text("location", 80) or "home",
        "detected_at": str(raw.get("detected_at") or "") or None,
    }


def clean(text):
    """Plain text for text-to-speech: no markup, no long digit runs (phone numbers), tidy spaces."""
    text = re.sub(r"[*_#`<>{}\[\]|\\]", " ", text)
    text = re.sub(r"\d{3,}", "", text)  # never read out numbers such as 999 or a phone number
    return re.sub(r"\s+", " ", text).strip()


def fallback(incident):
    when = malaysia_time(incident["detected_at"])
    what = LABELS[incident["type"]]
    detail = f" {incident['description']}" if incident["description"] else ""
    return {
        "intro": f"At {when}, Sentry detected {what} in the {incident['location']}.{detail}",
        "guidance": " ".join([GUIDANCE_START, *CHECKLISTS[incident["type"]]]),
        "summary": f"At {when}, Sentry detected {what} in the {incident['location']}.{detail} The demo location is {ADDRESS}.",
        "source": "template",
    }


def generate(incident):
    """Ask Nemotron for the script; fall back to the fixed one. Always returns a usable script."""
    incident = normalise_incident(incident)
    base = os.getenv("LLM_BASE_URL", "").strip().rstrip("/")
    model = os.getenv("LLM_MODEL", "").strip()
    if not base or not model:
        return {**fallback(incident), "note": "Nemotron not configured"}
    try:
        written = ask_model(base, model, incident)
    except (httpx.HTTPError, ValueError, KeyError, TypeError, IndexError) as error:
        return {**fallback(incident), "note": f"Nemotron unavailable: {type(error).__name__}"}
    return {**written, "source": "nemotron"}


def ask_model(base, model, incident):
    checklist = "\n".join(f"- {step}" for step in CHECKLISTS[incident["type"]])
    facts = {
        "emergency": LABELS[incident["type"]],
        "where": incident["location"],
        "when": malaysia_time(incident["detected_at"]),
        "what the camera AI saw": incident["description"],
        "household": HOUSEHOLD,
        "address": ADDRESS,
    }
    system = (
        "You write the spoken words for an automated phone call from Sentry, a home safety system, "
        "to a household's emergency contact. The words are read out by text to speech.\n"
        "Rules:\n"
        "- Use only the facts given. Do not invent names, injuries, medical conditions or other details.\n"
        "- Plain, calm, short sentences. No lists, symbols, markdown, emojis or phone numbers.\n"
        f"- guidance must start with \"{GUIDANCE_START}\" and use only steps from the checklist, "
        "ordered by what matters most. Do not add steps. Keep the exact meaning of every step you use: "
        "you may shorten the wording, but never drop a condition or qualifier (for example \"oil or electrical\").\n"
        "- intro: what Sentry detected, where and when, in at most 50 words. Do not greet; the greeting is added for you.\n"
        "- summary: for a second call to emergency services: what happened, where, when and the address, in at most 50 words.\n"
        "Reply with ONLY a JSON object: {\"intro\": \"...\", \"guidance\": \"...\", \"summary\": \"...\"}"
    )
    user = json.dumps({"facts": facts, "checklist": CHECKLISTS[incident["type"]]}) + "\nChecklist:\n" + checklist
    headers = {"Authorization": f"Bearer {os.environ['LLM_API_KEY']}"} if os.getenv("LLM_API_KEY") else {}
    response = httpx.post(
        base + "/chat/completions",
        headers=headers,
        timeout=float(os.getenv("CALL_SCRIPT_TIMEOUT_S", "20")),
        json={
            "model": model,
            "temperature": 0.2,
            "max_tokens": 500,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            # Nemotron reasoning models: answer directly. Ignored by models without the switch.
            "chat_template_kwargs": {"enable_thinking": False},
            "response_format": {"type": "json_schema", "json_schema": {"name": "call_script", "schema": SCHEMA}},
        },
    )
    response.raise_for_status()
    content = response.json()["choices"][0]["message"]["content"] or ""
    content = re.sub(r"<think>[\s\S]*?(</think>|$)", "", content)
    data = json.loads(content[content.index("{"): content.rindex("}") + 1])
    script = {}
    for key, limit in MAX_LENGTH.items():
        value = clean(str(data[key]))
        if len(value) < 15:
            raise ValueError(f"{key} is too short")
        script[key] = value[:limit]
    if not script["guidance"].lower().startswith(GUIDANCE_START.lower()[:-1]):
        script["guidance"] = f"{GUIDANCE_START} {script['guidance']}"
    return script


# ---------- Fixed framing around the model's words ----------

def spoken_intro(script):
    return f"Hello, this is a Sentry home safety demonstration for the {HOUSEHOLD}. {script['intro']}"


def spoken_summary(script):
    return (
        "This is an automated Sentry demonstration, not a real emergency request. "
        f"{script['summary']} The emergency contact explicitly requested this demo escalation call."
    )
