import json
import os
import tempfile
import unittest
from unittest.mock import Mock, patch

import httpx
from twilio.request_validator import RequestValidator

from sentry_calls.app import app
from sentry_calls.core import database, decision, validate_destination
from sentry_calls.script import generate, normalise_incident, spoken_intro, spoken_summary


class CallTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {
            "CALL_DB": self.temp.name + "/test.db",
            "PUBLIC_BASE_URL": "https://example.test",
            "TWILIO_AUTH_TOKEN": "test-token",
            "TWILIO_ACCOUNT_SID": "ACtest",
            "TWILIO_FROM_NUMBER": "+15550000000",
            "APPROVED_DEMO_NUMBERS": "+15550000001,+15550000002",
            "DEMO_ESCALATION_PHONE": "+15550000002",
            "LLM_API_KEY": "",
            "LLM_BASE_URL": "",
            "LLM_MODEL": "",
        })
        self.env.start()
        with database() as db:
            db.execute("INSERT INTO runs(id,contact_sid) VALUES ('test','CAcontact')")
        self.web = app.test_client()

    def tearDown(self):
        self.env.stop()
        self.temp.cleanup()

    def post(self, path, **fields):
        data = {"AccountSid": "ACtest", "CallSid": "CAcontact", **fields}
        sig = RequestValidator("test-token").compute_signature("https://example.test" + path, data)
        return self.web.post(path, data=data, headers={"X-Twilio-Signature": sig})

    def test_unsigned_callback_rejected(self):
        self.assertEqual(self.web.post("/voice/test/intro").status_code, 403)

    def test_unknown_call_rejected(self):
        self.assertEqual(self.post("/voice/test/intro", CallSid="CAother").status_code, 403)

    def test_destination_allow_list(self):
        for number in ("999", "112", "+999", "+15550000003", ""):
            with self.assertRaises(ValueError):
                validate_destination(number)
        self.assertEqual(validate_destination("+15550000001"), "+15550000001")

    @patch("sentry_calls.app.client")
    def test_yes_calls_once_across_duplicate_callbacks(self, client):
        client.return_value.calls.create.return_value = Mock(sid="CAsecond")
        first = self.post("/voice/test/reply/1", Digits="1")
        second = self.post("/voice/test/reply/1", Digits="1")
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.data, second.data)
        self.assertEqual(client.return_value.calls.create.call_count, 1)
        self.assertEqual(client.return_value.calls.create.call_args.kwargs["to"], "+15550000002")

    @patch("sentry_calls.app.client")
    def test_no_and_late_yes_do_not_call(self, client):
        self.post("/voice/test/reply/1", Digits="2")
        self.post("/voice/test/reply/2", Digits="1")
        client.assert_not_called()

    @patch("sentry_calls.app.client")
    def test_silence_exhausts_without_call(self, client):
        for attempt in (1, 2, 3):
            self.assertEqual(self.post(f"/voice/test/reply/{attempt}").status_code, 200)
        client.assert_not_called()
        with database() as db:
            self.assertEqual(db.execute("SELECT decision FROM runs").fetchone()[0], "unclear")

    @patch("sentry_calls.app.client")
    def test_ambiguous_provider_failure_not_retried(self, client):
        client.return_value.calls.create.side_effect = TimeoutError()
        self.post("/voice/test/reply/1", Digits="1")
        self.post("/voice/test/reply/1", Digits="1")
        self.assertEqual(client.return_value.calls.create.call_count, 1)
        with database() as db:
            self.assertEqual(db.execute("SELECT escalation_state FROM runs").fetchone()[0], "unknown")

    def test_conservative_speech_and_dtmf(self):
        self.assertEqual(decision(speech="yes", confidence="0.95"), "yes")
        self.assertEqual(decision(speech="yes", confidence="0.2"), "unclear")
        self.assertEqual(decision(speech="yes"), "unclear")
        self.assertEqual(decision(speech="yes but no", confidence="0.95"), "unclear")
        self.assertEqual(decision(digits="2", speech="yes", confidence="0.95"), "no")

    @patch.dict(os.environ, {"LLM_API_KEY": "", "LLM_MODEL": "nemotron-test", "LLM_BASE_URL": "http://spark:8000/v1"})
    @patch("sentry_calls.core.httpx.post")
    def test_ai_yes_requires_confirmation(self, post):
        post.return_value.json.return_value = {"choices": [{"message": {"content": '{"decision":"yes"}'}}]}
        self.assertEqual(decision(speech="please get someone to help", confidence="0.99"), "confirm_yes")
        self.assertEqual(post.call_args.args[0], "http://spark:8000/v1/chat/completions")
        self.assertEqual(post.call_args.kwargs["headers"], {})
        self.assertEqual(post.call_args.kwargs["json"]["model"], "nemotron-test")


class ScriptTests(unittest.TestCase):
    """The call script Nemotron writes from Sentry's incident (sentry_calls/script.py)."""

    INCIDENT = {"type": "fire_smoke", "description": "Flames and smoke rising from the stove.", "location": "Kitchen", "detected_at": "2026-10-17T09:00:00+00:00"}
    ENV = {"LLM_API_KEY": "", "LLM_MODEL": "omni", "LLM_BASE_URL": "http://spark:9001/v1"}

    def reply(self, post, content):
        post.return_value.json.return_value = {"choices": [{"message": {"content": content}}]}

    @patch.dict(os.environ, {"LLM_BASE_URL": "", "LLM_MODEL": ""})
    def test_fixed_script_without_a_model(self):
        script = generate(self.INCIDENT)
        self.assertEqual(script["source"], "template")
        self.assertIn("fire or smoke in the Kitchen", script["intro"])
        self.assertIn("5:00 pm Malaysia time", script["intro"])
        self.assertTrue(script["guidance"].startswith("Here is what to do right now."))
        self.assertIn("leave the house", script["guidance"])

    @patch.dict(os.environ, ENV)
    @patch("sentry_calls.script.httpx.post")
    def test_nemotron_writes_the_script(self, post):
        self.reply(post, json.dumps({
            "intro": "Sentry saw flames and smoke on the kitchen stove at 5 pm.",
            "guidance": "Here is what to do right now. Get everyone out of the house and close the doors.",
            "summary": "Fire on the kitchen stove at the demo address at 5 pm.",
        }))
        script = generate(self.INCIDENT)
        self.assertEqual(script["source"], "nemotron")
        self.assertIn("flames and smoke", script["intro"])
        sent = post.call_args.kwargs["json"]
        self.assertEqual(sent["model"], "omni")
        self.assertIn("leave the house straight away", sent["messages"][1]["content"])  # the fire checklist

    @patch.dict(os.environ, ENV)
    @patch("sentry_calls.script.httpx.post")
    def test_model_text_is_cleaned(self, post):
        self.reply(post, json.dumps({
            "intro": "**Fire** in the kitchen. Call 999 or +60123456789 now!" + " very" * 200,
            "guidance": "Get everyone out and close the doors behind you.",
            "summary": "Fire in the kitchen of the demo home.",
        }))
        script = generate(self.INCIDENT)
        self.assertNotIn("999", script["intro"])
        self.assertNotIn("60123456789", script["intro"])
        self.assertNotIn("*", script["intro"])
        self.assertLessEqual(len(script["intro"]), 400)
        self.assertTrue(script["guidance"].startswith("Here is what to do right now."))

    @patch.dict(os.environ, ENV)
    @patch("sentry_calls.script.httpx.post")
    def test_bad_model_reply_falls_back(self, post):
        for content in ("not json", '{"intro": "x", "guidance": "y", "summary": "z"}', json.dumps({"intro": "Fire."})):
            self.reply(post, content)
            self.assertEqual(generate(self.INCIDENT)["source"], "template", content)
        post.side_effect = httpx.ConnectError("down")
        self.assertEqual(generate(self.INCIDENT)["source"], "template")

    def test_unknown_type_becomes_other(self):
        self.assertEqual(normalise_incident({"type": "alien invasion"})["type"], "other")

    def test_framing_stays_fixed(self):
        script = {"intro": "Fire in the kitchen.", "guidance": "Here is what to do right now. Leave.", "summary": "Fire in the kitchen."}
        self.assertTrue(spoken_intro(script).startswith("Hello, this is a Sentry home safety demonstration"))
        self.assertTrue(spoken_summary(script).startswith("This is an automated Sentry demonstration, not a real emergency request."))


class ScriptedCallTests(CallTests):
    """A call started with --incident speaks the stored script inside the fixed framing."""

    SCRIPT = {"intro": "Sentry saw smoke in the kitchen.", "guidance": "Here is what to do right now. Leave the house.", "summary": "Smoke in the kitchen.", "source": "nemotron"}

    def setUp(self):
        super().setUp()
        with database() as db:
            db.execute("UPDATE runs SET script=? WHERE id='test'", (json.dumps(self.SCRIPT),))

    def test_intro_speaks_the_stored_script(self):
        body = self.post("/voice/test/intro").data.decode()
        self.assertIn("Hello, this is a Sentry home safety demonstration", body)
        self.assertIn("Sentry saw smoke in the kitchen.", body)
        self.assertIn("Leave the house.", body)
        self.assertIn("Do you want me to call emergency services?", body)  # the fixed question
        self.assertNotIn("fallen beside the living room sofa", body)

    @patch("sentry_calls.app.client")
    def test_escalation_uses_the_stored_summary(self, client):
        client.return_value.calls.create.return_value = Mock(sid="CAsecond")
        self.post("/voice/test/reply/1", Digits="1")
        twiml = client.return_value.calls.create.call_args.kwargs["twiml"]
        self.assertIn("This is an automated Sentry demonstration", twiml)
        self.assertIn("Smoke in the kitchen.", twiml)


if __name__ == "__main__":
    unittest.main()
