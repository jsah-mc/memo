"""Model-facing desktop tool definitions and request detection."""

MAX_SCREEN_EDGE = 1600
MAX_ACTIONS = 12

SCREEN_TOOL_DEFINITION = {
    "type": "function",
    "name": "inspect_computer_screen",
    "description": (
        "Capture the primary desktop display through CUA Driver so you can see apps and "
        "controls. Use this before clicking and again whenever the screen may "
        "have changed. A user approval grants screen and input access only for "
        "the current task."
        "If The User Says Anything Related or says something like see the screen You Can Use This Tool"
        "To See And Give The User What You Saw"
    ),
    "parameters": {
        "type": "object",
        "additionalProperties": False,
        "properties": {},
    },
    "strict": True,
}

CONTROL_TOOL_DEFINITION = {
    "type": "function",
    "name": "control_computer",
    "description": (
        "Perform a short sequence of mouse and keyboard actions, then "
        "return a fresh screenshot. Coordinates use the pixel dimensions from "
        "the latest screenshot. Supported actions are click, double_click, "
        "move, type, press, hotkey, scroll, and wait. Keep each sequence short "
        "and inspect the resulting screen before deciding the next actions. Scroll acts at the last pointer action, or the screen center before any pointer action."
    ),
    "parameters": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "actions": {
                "type": "array",
                "minItems": 1,
                "maxItems": MAX_ACTIONS,
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "action": {
                            "type": "string",
                            "enum": [
                                "click",
                                "double_click",
                                "move",
                                "type",
                                "press",
                                "hotkey",
                                "scroll",
                                "wait",
                            ],
                        },
                        "x": {"type": "integer"},
                        "y": {"type": "integer"},
                        "button": {
                            "type": "string",
                            "enum": ["left", "right", "middle"],
                        },
                        "text": {"type": "string", "maxLength": 4_000},
                        "key": {"type": "string", "maxLength": 32},
                        "keys": {
                            "type": "array",
                            "minItems": 2,
                            "maxItems": 4,
                            "items": {"type": "string", "maxLength": 32},
                        },
                        "amount": {
                            "type": "integer",
                            "minimum": -20,
                            "maximum": 20,
                        },
                        "seconds": {
                            "type": "number",
                            "minimum": 0,
                            "maximum": 5,
                        },
                    },
                    "required": ["action"],
                },
            }
        },
        "required": ["actions"],
    },
    "strict": False,
}
_DESKTOP_CONTROL_TERMS = (
    "click",
    "double click",
    "right click",
    "type ",
    "enter ",
    "press ",
    "scroll",
    "move the mouse",
    "use the computer",
    "use my computer",
    "control the computer",
    "control my computer",
    "interact with",
    "see my screen",
    "see the screen",
    "view my screen",
    "view the screen",
    "look at my screen",
    "look at the screen",
    "inspect my screen",
    "inspect the screen",
    "what's on my screen",
    "what is on my screen",
    "tell me what's on my screen",
    "tell me whats on my screen",
)


def detect_desktop_control_request(text: str) -> bool:
    """Return whether a request needs visible desktop interaction."""

    lowered = text.casefold()
    if any(term in lowered for term in _DESKTOP_CONTROL_TERMS):
        return True
    opens_then_interacts = any(
        verb in lowered for verb in ("open ", "launch ", "start ")
    ) and any(conjunction in lowered for conjunction in (" and ", " then "))
    return opens_then_interacts
