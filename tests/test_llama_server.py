"""llama_server.py: the request Layer B sends, and the rule that it only ever reaches a local
server. No server runs here; the module's opener is replaced by canned replies.
"""
import io
import json
import os
import unittest
import urllib.error
import urllib.request
from unittest import mock

from scripts.enrich import llama_server
from scripts.enrich.llama_server import LlamaServerError

SCHEMA = {"type": "object", "properties": {"es": {"type": "string"}}, "required": ["es"]}


class _Reply:
    """Stands in for the response object _OPENER.open() returns."""

    def __init__(self, payload):
        self._body = payload if isinstance(payload, bytes) else json.dumps(payload).encode()

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _chat(content, finish_reason="stop"):
    return _Reply({"choices": [{"message": {"content": content}, "finish_reason": finish_reason}]})


def _models(*ids):
    return _Reply({"data": [{"id": model_id} for model_id in ids]})


def _proxy_handlers(opener):
    return [h for h in opener.handlers if isinstance(h, urllib.request.ProxyHandler)]


class _ServerTestCase(unittest.TestCase):
    def setUp(self):
        env = mock.patch.dict(os.environ)
        env.start()
        self.addCleanup(env.stop)
        os.environ.pop(llama_server.ENV_URL, None)

        # generate_json and pick_model report retries and fallbacks on stdout.
        quiet = mock.patch("sys.stdout", new_callable=io.StringIO)
        quiet.start()
        self.addCleanup(quiet.stop)

    def serve(self, *replies):
        opened = mock.patch.object(llama_server._OPENER, "open", side_effect=list(replies))
        self.addCleanup(opened.stop)
        return opened.start()

    @staticmethod
    def sent_body(opened, call=0):
        return json.loads(opened.call_args_list[call].args[0].data)


class RequestShapeTest(_ServerTestCase):
    def test_request_body_matches_what_was_verified_against_the_server(self):
        opened = self.serve(_chat('{"es": "x"}'))
        llama_server.generate_json("qwen3-8b", "the prompt", SCHEMA)

        request = opened.call_args.args[0]
        self.assertTrue(request.full_url.endswith("/v1/chat/completions"))
        body = self.sent_body(opened)
        self.assertEqual(body["model"], "qwen3-8b")
        self.assertEqual(body["messages"], [{"role": "user", "content": "the prompt"}])
        self.assertEqual(body["chat_template_kwargs"], {"enable_thinking": False})
        self.assertEqual(body["response_format"]["type"], "json_schema")
        self.assertEqual(body["response_format"]["json_schema"]["schema"], SCHEMA)
        self.assertEqual(body["max_tokens"], 700)
        self.assertIs(body["stream"], False)
        for key, value in llama_server.SAMPLING.items():
            self.assertEqual(body[key], value, key)

    def test_request_never_sets_a_seed(self):
        # A fixed seed would make describe()'s retry regenerate the text it just rejected.
        opened = self.serve(_chat('{"es": "x"}'))
        llama_server.generate_json("qwen3-8b", "the prompt", SCHEMA)
        self.assertNotIn("seed", self.sent_body(opened))

    def test_without_a_schema_it_asks_for_any_json_object(self):
        opened = self.serve(_chat('{"es": "x"}'))
        llama_server.generate_json("qwen3-8b", "the prompt")
        self.assertEqual(self.sent_body(opened)["response_format"], {"type": "json_object"})

    def test_returns_the_parsed_object_and_the_seconds_spent(self):
        self.serve(_chat('{"es": "hola"}'))
        parsed, seconds = llama_server.generate_json("qwen3-8b", "the prompt", SCHEMA)
        self.assertEqual(parsed, {"es": "hola"})
        self.assertIsInstance(seconds, float)

    def test_thinking_block_is_stripped_before_parsing(self):
        self.serve(_chat('<think>weighing it up</think>\n{"es": "hola"}'))
        parsed, _ = llama_server.generate_json("qwen3-8b", "the prompt", SCHEMA)
        self.assertEqual(parsed, {"es": "hola"})


class RetryTest(_ServerTestCase):
    def test_invalid_json_is_retried_once(self):
        opened = self.serve(_chat("not json", "length"), _chat('{"es": "hola"}'))
        parsed, _ = llama_server.generate_json("qwen3-8b", "the prompt", SCHEMA)
        self.assertEqual(parsed, {"es": "hola"})
        self.assertEqual(opened.call_count, 2)

    def test_two_invalid_replies_raise_value_error(self):
        self.serve(_chat("not json"), _chat("still not json"))
        with self.assertRaises(ValueError):
            llama_server.generate_json("qwen3-8b", "the prompt", SCHEMA)

    def test_a_json_list_counts_as_a_failed_attempt(self):
        opened = self.serve(_chat("[1, 2]"), _chat('{"es": "hola"}'))
        parsed, _ = llama_server.generate_json("qwen3-8b", "the prompt", SCHEMA)
        self.assertEqual(parsed, {"es": "hola"})
        self.assertEqual(opened.call_count, 2)

    def test_a_reply_without_choices_counts_as_a_failed_attempt(self):
        opened = self.serve(_Reply({"error": "busy"}), _chat('{"es": "hola"}'))
        parsed, _ = llama_server.generate_json("qwen3-8b", "the prompt", SCHEMA)
        self.assertEqual(parsed, {"es": "hola"})
        self.assertEqual(opened.call_count, 2)


class ServerErrorTest(_ServerTestCase):
    def test_unreachable_server_is_a_server_error(self):
        self.serve(urllib.error.URLError("connection refused"))
        with self.assertRaises(LlamaServerError):
            llama_server.generate_json("qwen3-8b", "the prompt", SCHEMA)

    def test_http_error_is_a_server_error(self):
        url = "http://127.0.0.1:8080/v1/chat/completions"
        self.serve(urllib.error.HTTPError(url, 400, "Bad Request", None, None))
        with self.assertRaises(LlamaServerError):
            llama_server.generate_json("qwen3-8b", "the prompt", SCHEMA)

    def test_a_non_json_reply_is_a_server_error_not_a_rejection(self):
        # Another service on the port must stop the run, not count as a rejected description.
        self.serve(_Reply(b"<html>not llama-server</html>"))
        with self.assertRaises(LlamaServerError):
            llama_server.available()


class PickModelTest(_ServerTestCase):
    def test_prefers_the_primary_model(self):
        opened = self.serve(_models("qwen3-8b", "qwen3-coder-30b"))
        self.assertEqual(llama_server.pick_model(), "qwen3-coder-30b")
        self.assertTrue(opened.call_args.args[0].endswith("/v1/models"))

    def test_fast_prefers_the_fast_model(self):
        self.serve(_models("qwen3-8b", "qwen3-coder-30b"))
        self.assertEqual(llama_server.pick_model(fast=True), "qwen3-8b")

    def test_falls_back_to_whichever_model_is_served(self):
        self.serve(_models("qwen3-8b"))
        self.assertEqual(llama_server.pick_model(), "qwen3-8b")

    def test_neither_model_served_names_what_the_server_offers(self):
        self.serve(_models("nomic-embed-text"))
        with self.assertRaises(LlamaServerError) as raised:
            llama_server.pick_model()
        self.assertIn("nomic-embed-text", str(raised.exception))


class LoopbackOnlyTest(_ServerTestCase):
    def test_rejects_non_loopback_url_before_any_request(self):
        for url in (
            "http://example.com:8080",
            "http://192.168.1.10:8080",
            "http://localhost.evil.com",
            "http://127.0.0.1@evil.com",
            "ftp://127.0.0.1",
        ):
            with self.subTest(url=url):
                os.environ[llama_server.ENV_URL] = url
                opened = self.serve(_models("qwen3-coder-30b"))
                with self.assertRaises(LlamaServerError):
                    llama_server.pick_model()
                with self.assertRaises(LlamaServerError):
                    llama_server.generate_json("qwen3-8b", "the prompt", SCHEMA)
                opened.assert_not_called()

    def test_accepts_loopback_urls(self):
        for url in (
            "http://localhost:8080",
            "http://LOCALHOST:8080",
            "http://127.0.0.1:9000",
            "http://[::1]:8080/",
        ):
            with self.subTest(url=url):
                os.environ[llama_server.ENV_URL] = url
                self.assertEqual(llama_server.base_url(), url.rstrip("/"))

    def test_system_proxy_is_bypassed(self):
        proxy = "http://proxy.invalid:3128"
        with mock.patch.dict(os.environ, {"http_proxy": proxy, "HTTP_PROXY": proxy}):
            control = urllib.request.build_opener()
            opener = llama_server._build_opener()
        self.assertTrue(_proxy_handlers(control), "the control opener should pick up the proxy")
        self.assertFalse(_proxy_handlers(opener))


if __name__ == "__main__":
    unittest.main()
