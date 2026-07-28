from unittest import IsolatedAsyncioTestCase, TestCase
from unittest.mock import ANY, AsyncMock, patch

from utils.browser.llm import MemoChatModel
from utils.browser.main import _direct_url, _duckduckgo_request, _headless_for_task
from utils.gateway.browser import detect_browser_task, run_browser_tool_turn
from utils.tools.browser import BrowserUseTool


class FakeStream:
    def __init__(self, response: dict):
        self.response = response

    async def completed_response(self) -> dict:
        return self.response


class FakeSDK:
    def __init__(self, initial: dict, final: dict):
        self.initial = initial
        self.final = FakeStream(final)
        self.completion_payloads: list[dict] = []
        self.stream_payloads: list[dict] = []

    async def completion(self, payload: dict) -> dict:
        self.completion_payloads.append(payload)
        return self.initial

    async def completion_stream(self, payload: dict) -> FakeStream:
        self.stream_payloads.append(payload)
        return self.final


class BrowserIntentTests(TestCase):
    def test_detects_explicit_browser_requests(self) -> None:
        self.assertEqual(
            detect_browser_task("Use the browser to open example.com"),
            "Use the browser to open example.com",
        )
        self.assertEqual(
            detect_browser_task(
                "open the browser and find some wikipedia page about turtles"
            ),
            "open the browser and find some wikipedia page about turtles",
        )
        self.assertEqual(
            detect_browser_task(
                [
                    {"role": "user", "content": "Hello"},
                    {"role": "assistant", "content": "Hi"},
                    {"role": "user", "content": "Visit python.org"},
                ]
            ),
            "Visit python.org",
        )
        self.assertEqual(
            detect_browser_task("Hey search on duck duck go for hello"),
            "Hey search on duck duck go for hello",
        )
        self.assertEqual(
            detect_browser_task("Search using Google for Python"),
            "Search using Google for Python",
        )

    def test_ignores_normal_chat(self) -> None:
        self.assertIsNone(detect_browser_task("Explain how DNS works"))
        self.assertIsNone(detect_browser_task("Open source software is useful"))

    def test_all_browser_tasks_are_visible_unless_headless_is_enabled(self) -> None:
        with patch.dict("os.environ", {}, clear=True):
            self.assertFalse(_headless_for_task("Search DuckDuckGo for hello"))
            self.assertFalse(_headless_for_task("Visit example.com"))
        with patch.dict("os.environ", {"MEMO_BROWSER_HEADLESS": "1"}, clear=True):
            self.assertTrue(_headless_for_task("Search DuckDuckGo for hello"))
            self.assertTrue(_headless_for_task("Visit example.com"))
        with patch.dict("os.environ", {"MEMO_BROWSER_HEADLESS": "false"}, clear=True):
            self.assertFalse(_headless_for_task("Visit example.com"))

    def test_extracts_duckduckgo_query_and_result_count(self) -> None:
        self.assertEqual(
            _duckduckgo_request(
                "Hey search on duck duck go for hello and give me first 5 results"
            ),
            ("hello", 5),
        )
        self.assertEqual(
            _duckduckgo_request("Search DuckDuckGo for Python asyncio"),
            ("Python asyncio", 5),
        )

    def test_unwraps_duckduckgo_redirect_urls(self) -> None:
        self.assertEqual(
            _direct_url(
                "http://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs"
            ),
            "https://example.com/docs",
        )


class BrowserToolSchemaTests(TestCase):
    def test_exposes_litellm_function_schema(self) -> None:
        definition = BrowserUseTool().litellm_definition
        self.assertEqual(definition["type"], "function")
        self.assertEqual(definition["function"]["name"], "browse_web")
        self.assertIn("task", definition["function"]["parameters"]["properties"])


class BrowserModelTests(IsolatedAsyncioTestCase):
    async def test_uses_in_process_sdk_without_local_gateway(self) -> None:
        stream = AsyncMock()
        stream.completed_response.return_value = {
            "status": "completed",
            "output_text": "done",
            "usage": {
                "input_tokens": 2,
                "output_tokens": 1,
                "total_tokens": 3,
            },
        }
        sdk = AsyncMock()
        sdk.responses.return_value = stream
        model = MemoChatModel("codex", sdk=sdk)

        result = await model.ainvoke([], None)

        self.assertEqual(result.completion, "done")
        self.assertTrue(model.model.startswith("chatgpt/"))
        sdk.responses.assert_awaited_once_with({"input": []})


class BrowserToolExecutionTests(IsolatedAsyncioTestCase):
    async def test_executes_in_main_environment_without_uv_subprocess(self) -> None:
        result = {
            "ok": True,
            "task": "Visit example.com",
            "result": "Example Domain",
            "urls": ["https://example.com"],
        }
        with patch(
            "utils.tools.browser.execute_browser_task",
            new=AsyncMock(return_value=result),
        ) as execute:
            actual = await BrowserUseTool().execute({"task": "Visit example.com"})

        self.assertEqual(actual, result)
        execute.assert_awaited_once()
        self.assertEqual(execute.await_args.args[0], "Visit example.com")


class BrowserAIToolTests(IsolatedAsyncioTestCase):
    async def test_executes_exact_authorized_task_and_returns_followup(self) -> None:
        authorized_task = "Use the browser to visit example.com"
        sdk = FakeSDK(
            {},
            {"output_text": "Example Domain is available."},
        )
        tool = AsyncMock()
        tool.name = "browse_web"
        tool.litellm_definition = {
            "type": "function",
            "function": {"name": "browse_web", "parameters": {}},
        }
        tool.execute.return_value = {
            "ok": True,
            "result": "Example Domain",
            "urls": ["https://example.com"],
        }

        stream = await run_browser_tool_turn(
            sdk,
            {"input": authorized_task},
            authorized_task,
            tool,
        )

        self.assertEqual(
            await stream.completed_response(),
            {
                "id": ANY,
                "object": "response",
                "status": "completed",
                "output": [ANY],
                "usage": {
                    "input_tokens": 0,
                    "output_tokens": 0,
                    "total_tokens": 0,
                },
                "output_text": "Example Domain",
            },
        )
        tool.execute.assert_awaited_once_with({"task": authorized_task})
        self.assertEqual(sdk.completion_payloads, [])
        self.assertEqual(sdk.stream_payloads, [])
