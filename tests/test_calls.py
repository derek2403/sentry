import os
import tempfile
import unittest
from unittest.mock import Mock, patch

from twilio.request_validator import RequestValidator

from sentry_calls.app import app
from sentry_calls.core import database, decision, validate_destination


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


if __name__ == "__main__":
    unittest.main()
