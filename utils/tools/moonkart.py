"""Bluetooth control client and interactive CLI for MoonKart."""

from __future__ import annotations

import asyncio
import copy
import sys
from collections.abc import Callable
from typing import ClassVar

from bleak import BleakClient, BleakScanner
from bleak.backends.characteristic import BleakGATTCharacteristic
from bleak.backends.device import BLEDevice

DEVICE_NAME = "MoonKart"

# Nordic UART Service (NUS) UUIDs used by MoonKart.
UART_SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
UART_RX_CHAR_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"
UART_TX_CHAR_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"

_MOONKART_LITELLM_DEFINITION = {
    "type": "function",
    "function": {
        "name": "control_moonkart",
        "description": (
            "Start or stop the nearby MoonKart over Bluetooth. Use start only when "
            "the user explicitly asks to start MoonKart or MoonCart or anything related, and stop only "
            "when the user explicitly asks to stop it."
        ),
        "parameters": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["start", "stop"],
                    "description": "The requested MoonKart action.",
                }
            },
            "required": ["action"],
        },
        "strict": True,
    },
}

ResponseHandler = Callable[[str | bytes], None]
DisconnectHandler = Callable[[], None]


def _prepare_windows_bluetooth_thread() -> None:
    """Undo accidental STA initialization before Bleak starts WinRT."""

    if sys.platform != "win32":
        return
    from bleak.backends.winrt import util

    # A dependency may have called CoInitialize more than once. Bleak's public
    # helper removes one reference, so repeat only while the thread remains STA.
    for _ in range(16):
        try:
            apartment, _ = util._get_apartment_type()
        except OSError as exc:
            if exc.winerror == util._CO_E_NOTINITIALIZED:
                return
            raise
        if apartment == util._AptType.MTA:
            return
        util.uninitialize_sta()
    raise RuntimeError("Could not reset the Windows COM thread for Bluetooth.")


class MoonKartNotFoundError(ConnectionError):
    """Raised when a MoonKart cannot be found during Bluetooth discovery."""


class MoonKartClient:
    """Connect to and send Nordic UART commands to a MoonKart over BLE."""

    def __init__(
        self,
        device_name: str = DEVICE_NAME,
        *,
        response_handler: ResponseHandler | None = None,
        disconnect_handler: DisconnectHandler | None = None,
    ) -> None:
        self.device_name = device_name
        self.response_handler = response_handler
        self.disconnect_handler = disconnect_handler
        self._client: BleakClient | None = None

    @property
    def is_connected(self) -> bool:
        return self._client is not None and self._client.is_connected

    async def find_device(self) -> BLEDevice:
        """Scan until a BLE device with the configured name is found."""

        _prepare_windows_bluetooth_thread()
        device = await BleakScanner.find_device_by_filter(
            lambda candidate, advertisement: (
                candidate.name == self.device_name
                or advertisement.local_name == self.device_name
            )
        )
        if device is None:
            raise MoonKartNotFoundError(
                f"Could not find '{self.device_name}'. Check its power and Bluetooth."
            )
        return device

    async def connect(self) -> BLEDevice:
        """Discover MoonKart, connect, and subscribe to UART responses."""

        if self.is_connected:
            raise RuntimeError("MoonKart is already connected.")

        device = await self.find_device()
        client = BleakClient(device, disconnected_callback=self._handle_disconnect)
        self._client = client
        try:
            await client.connect()
            await client.start_notify(UART_TX_CHAR_UUID, self._handle_rx)
        except Exception:
            self._client = None
            if client.is_connected:
                await client.disconnect()
            raise
        return device

    async def send(self, command: str) -> None:
        """Send one newline-terminated command through MoonKart's UART service."""

        command = command.strip()
        if not command:
            raise ValueError("MoonKart command cannot be empty.")
        if not self.is_connected or self._client is None:
            raise RuntimeError("MoonKart is not connected.")

        await self._client.write_gatt_char(
            UART_RX_CHAR_UUID,
            f"{command}\n".encode(),
            response=True,
        )

    async def disconnect(self) -> None:
        """Stop UART notifications and disconnect, if currently connected."""

        client = self._client
        self._client = None
        if client is None or not client.is_connected:
            return

        try:
            await client.stop_notify(UART_TX_CHAR_UUID)
        finally:
            await client.disconnect()

    def _handle_disconnect(self, _: BleakClient) -> None:
        self._client = None
        if self.disconnect_handler is not None:
            self.disconnect_handler()

    def _handle_rx(self, _: BleakGATTCharacteristic, data: bytearray) -> None:
        try:
            response: str | bytes = data.decode("utf-8").strip()
        except UnicodeDecodeError:
            response = bytes(data)

        if self.response_handler is not None:
            self.response_handler(response)


class MoonKartTool:
    """LiteLLM function tool backed by one reusable MoonKart BLE connection."""

    name = "control_moonkart"
    COMMANDS: ClassVar[dict[str, str]] = {"start": "H", "stop": "S"}

    def __init__(self, client: MoonKartClient | None = None) -> None:
        self.client = client or MoonKartClient()
        self._lock = asyncio.Lock()

    @property
    def litellm_definition(self) -> dict:
        """Return this tool's schema for ``litellm.acompletion``."""

        return copy.deepcopy(_MOONKART_LITELLM_DEFINITION)

    @property
    def responses_definition(self) -> dict:
        """Return this tool's flat schema for ``litellm.aresponses``."""

        definition = self.litellm_definition
        return {"type": definition["type"], **definition["function"]}

    async def execute(self, arguments: dict) -> dict[str, str | bool]:
        """Validate LiteLLM function arguments and execute the requested action."""

        action = arguments.get("action")
        if not isinstance(action, str):
            raise TypeError("MoonKart tool arguments require an `action` string.")
        return await self.control(action)

    async def control(self, action: str) -> dict[str, str | bool]:
        """Connect if necessary, then issue the command for an authorized action."""

        command = self.COMMANDS.get(action)
        if command is None:
            raise ValueError("MoonKart action must be `start` or `stop`.")

        async with self._lock:
            if not self.client.is_connected:
                await self.client.connect()
            await self.client.send(command)

        return {
            "ok": True,
            "device": DEVICE_NAME,
            "action": action,
            "command": command,
        }

    async def close(self) -> None:
        """Disconnect the shared BLE client when the gateway shuts down."""

        async with self._lock:
            await self.client.disconnect()


def _print_response(response: str | bytes) -> None:
    if isinstance(response, str):
        print(f"\n[MoonKart Response]: {response}")
    else:
        print(f"\n[MoonKart Raw Data]: {response!r}")
    print("> ", end="", flush=True)


def _print_disconnect() -> None:
    print("\n[BLE] MoonKart disconnected.")


async def main() -> None:
    """Run the interactive MoonKart teleoperation terminal."""

    moonkart = MoonKartClient(
        response_handler=_print_response,
        disconnect_handler=_print_disconnect,
    )
    print(f"[BLE] Scanning for '{moonkart.device_name}'...")

    try:
        device = await moonkart.connect()
    except MoonKartNotFoundError as exc:
        print(f"[ERROR] {exc}")
        return

    print(f"[BLE] Found {device.name} [{device.address}].")
    print(f"[BLE] Connected to {moonkart.device_name} successfully!")
    print("-" * 50)
    print("MoonKart Teleoperation CLI ready.")
    print("Type commands (for example, 'H' or 'S') and press Enter.")
    print("Type 'exit' to quit.")
    print("-" * 50)

    loop = asyncio.get_running_loop()
    try:
        while moonkart.is_connected:
            print("> ", end="", flush=True)
            user_input = await loop.run_in_executor(None, sys.stdin.readline)
            command = user_input.strip()
            if not command:
                continue
            if command.lower() in {"exit", "quit"}:
                print("[BLE] Disconnecting from MoonKart...")
                break
            await moonkart.send(command)
    finally:
        await moonkart.disconnect()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nExiting program.")
