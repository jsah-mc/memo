from unittest import IsolatedAsyncioTestCase, TestCase
from unittest.mock import AsyncMock, MagicMock, patch

from utils.tools.moonkart import (
    UART_RX_CHAR_UUID,
    UART_TX_CHAR_UUID,
    MoonKartClient,
    MoonKartTool,
)


class MoonKartClientTests(IsolatedAsyncioTestCase):
    async def test_connect_send_and_disconnect(self) -> None:
        device = MagicMock(name="device")
        device.name = "MoonKart"
        device.address = "AA:BB:CC:DD:EE:FF"

        bleak_client = MagicMock(name="bleak_client")
        bleak_client.is_connected = True
        bleak_client.connect = AsyncMock()
        bleak_client.start_notify = AsyncMock()
        bleak_client.write_gatt_char = AsyncMock()
        bleak_client.stop_notify = AsyncMock()
        bleak_client.disconnect = AsyncMock()

        with (
            patch(
                "utils.tools.moonkart.BleakScanner.find_device_by_filter",
                new=AsyncMock(return_value=device),
            ),
            patch(
                "utils.tools.moonkart.BleakClient", return_value=bleak_client
            ) as client_type,
        ):
            moonkart = MoonKartClient()
            found = await moonkart.connect()
            await moonkart.send("H")
            await moonkart.disconnect()

        self.assertIs(found, device)
        client_type.assert_called_once()
        bleak_client.connect.assert_awaited_once_with()
        bleak_client.start_notify.assert_awaited_once_with(
            UART_TX_CHAR_UUID, moonkart._handle_rx
        )
        bleak_client.write_gatt_char.assert_awaited_once_with(
            UART_RX_CHAR_UUID, b"H\n", response=True
        )
        bleak_client.stop_notify.assert_awaited_once_with(UART_TX_CHAR_UUID)
        bleak_client.disconnect.assert_awaited_once_with()
        self.assertFalse(moonkart.is_connected)

    async def test_rejects_send_while_disconnected(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "not connected"):
            await MoonKartClient().send("H")


class MoonKartResponseTests(TestCase):
    def test_decodes_text_and_preserves_binary_responses(self) -> None:
        responses: list[str | bytes] = []
        moonkart = MoonKartClient(response_handler=responses.append)

        moonkart._handle_rx(MagicMock(), bytearray(b"READY\n"))
        moonkart._handle_rx(MagicMock(), bytearray(b"\xff\xfe"))

        self.assertEqual(responses, ["READY", b"\xff\xfe"])


class MoonKartToolTests(IsolatedAsyncioTestCase):
    def test_exposes_litellm_completion_function_schema(self) -> None:
        tool = MoonKartTool(MagicMock(spec=MoonKartClient))

        definition = tool.litellm_definition

        self.assertEqual(definition["type"], "function")
        self.assertEqual(definition["function"]["name"], "control_moonkart")
        self.assertEqual(
            definition["function"]["parameters"]["properties"]["action"]["enum"],
            ["start", "stop"],
        )
        responses_definition = tool.responses_definition
        self.assertEqual(responses_definition["type"], "function")
        self.assertEqual(responses_definition["name"], "control_moonkart")
        self.assertNotIn("function", responses_definition)

    async def test_maps_start_and_stop_to_uart_commands(self) -> None:
        client = MagicMock(spec=MoonKartClient)
        client.is_connected = False
        client.connect = AsyncMock()
        client.send = AsyncMock()
        client.disconnect = AsyncMock()
        tool = MoonKartTool(client)

        started = await tool.execute({"action": "start"})
        client.is_connected = True
        stopped = await tool.execute({"action": "stop"})
        await tool.close()

        client.connect.assert_awaited_once_with()
        self.assertEqual(
            [call.args[0] for call in client.send.await_args_list], ["H", "S"]
        )
        client.disconnect.assert_awaited_once_with()
        self.assertEqual(started["command"], "H")
        self.assertEqual(stopped["command"], "S")
