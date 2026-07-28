from unittest import TestCase

from utils.gateway.router import ModelRouter


class ModelRouterTests(TestCase):
    def setUp(self) -> None:
        self.router = ModelRouter(
            light_model="chatgpt/gpt-5.4",
            heavy_model="chatgpt/gpt-5.4",
            vision_model="chatgpt/gpt-5.4",
        )

    def test_image_generation_language_routes_to_configured_model(self) -> None:
        route = self.router.route(
            {
                "input": [
                    {
                        "role": "user",
                        "content": "Generate an image of a turtle astronaut",
                    }
                ]
            }
        )

        self.assertEqual(route.kind, "light")
        self.assertEqual(route.model, "chatgpt/gpt-5.4")
        self.assertIsNone(route.reasoning_effort)

    def test_routes_simple_chat_to_codex(self) -> None:
        route = self.router.route({"input": "What is the capital of Iceland?"})

        self.assertEqual(route.kind, "light")
        self.assertEqual(route.model, "chatgpt/gpt-5.4")
        self.assertIsNone(route.reasoning_effort)

    def test_routes_heavy_work_to_codex(self) -> None:
        route = self.router.route(
            {"input": "Architect and implement a modular distributed job system."}
        )

        self.assertEqual(route.kind, "heavy")
        self.assertEqual(route.model, "chatgpt/gpt-5.4")
        self.assertIsNone(route.reasoning_effort)
        self.assertEqual(route.fallback_model, "chatgpt/gpt-5.4")

    def test_routes_attached_image_analysis_to_vision(self) -> None:
        route = self.router.route(
            {
                "input": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "input_text", "text": "Describe this."},
                            {
                                "type": "input_image",
                                "image_url": "data:image/png;base64,aW1hZ2U=",
                            },
                        ],
                    }
                ]
            }
        )

        self.assertEqual(route.kind, "vision")
        self.assertEqual(route.model, "chatgpt/gpt-5.4")
        self.assertIsNone(route.reasoning_effort)
