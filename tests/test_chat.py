from unittest import TestCase

from utils.gateway.chat import chat_to_responses, to_chat_completion


class ChatCompatibilityTests(TestCase):
    def test_converts_chat_request_to_responses_request(self) -> None:
        converted = chat_to_responses(
            {
                "model": "codex",
                "messages": [{"role": "user", "content": "Hello"}],
                "max_completion_tokens": 64,
                "temperature": 0.2,
            }
        )

        self.assertEqual(converted["input"], [{"role": "user", "content": "Hello"}])
        self.assertEqual(converted["max_output_tokens"], 64)
        self.assertEqual(converted["temperature"], 0.2)

    def test_converts_response_to_chat_completion(self) -> None:
        completion = to_chat_completion(
            {
                "output_text": "Hello back",
                "usage": {"input_tokens": 5, "output_tokens": 2, "total_tokens": 7},
            },
            "codex",
            "chatcmpl_test",
        )

        self.assertEqual(completion["object"], "chat.completion")
        self.assertEqual(completion["choices"][0]["message"]["content"], "Hello back")
        self.assertEqual(completion["usage"]["prompt_tokens"], 5)

    def test_converts_image_and_file_attachments(self) -> None:
        converted = chat_to_responses(
            {
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": "Describe these."},
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": "data:image/png;base64,aW1hZ2U=",
                                    "detail": "high",
                                },
                            },
                            {
                                "type": "file",
                                "file": {
                                    "filename": "notes.pdf",
                                    "file_data": "data:application/pdf;base64,cGRm",
                                },
                            },
                        ],
                    }
                ]
            }
        )

        self.assertEqual(
            converted["input"][0]["content"],
            [
                {"type": "input_text", "text": "Describe these."},
                {
                    "type": "input_image",
                    "image_url": "data:image/png;base64,aW1hZ2U=",
                    "detail": "high",
                },
                {
                    "type": "input_file",
                    "filename": "notes.pdf",
                    "file_data": "data:application/pdf;base64,cGRm",
                },
            ],
        )
