"""Run a Browser Use agent through Memo's in-process ChatGPT SDK."""

from __future__ import annotations

import argparse
import asyncio
import html
import json
import os
import re
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path

from dotenv import load_dotenv

DEFAULT_BASE_URL = ""
DEFAULT_MODEL = "chatgpt/gpt-5.4"
PROJECT_ROOT = Path(__file__).resolve().parents[2]
BROWSER_RECOVERY_INSTRUCTIONS = """
For DuckDuckGo searches, navigate directly to the read-only text rendering at
https://r.jina.ai/http://html.duckduckgo.com/html/?q=<url-encoded-query> and
extract the requested organic DuckDuckGo results from that page. This avoids
DuckDuckGo's CAPTCHA in automated browser sessions. Never claim that network
access is unavailable: you are operating a real browser. If the text rendering
fails, try DuckDuckGo's normal, HTML, and Lite endpoints before accurately
reporting the browser error or CAPTCHA.
""".strip()
_DUCKDUCKGO_TASK = re.compile(
    r"\bduck\s*duck\s*go\b.*?\b(?:for|about)\s+(.+)",
    re.IGNORECASE | re.DOTALL,
)
_RESULT_COUNT = re.compile(
    r"\b(?:first|top|give\s+me|return|show\s+me)?\s*(\d{1,2})\s+results?\b",
    re.IGNORECASE,
)
_RESULT_HEADING = re.compile(r"^## \[(.+?)]\((https?://.+?)\)\s*$", re.MULTILINE)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run Browser Use through Memo's in-process AI client."
    )
    parser.add_argument("task", help="Browser task for the agent to complete.")
    parser.add_argument(
        "--base-url",
        default=os.environ.get("MEMO_BASE_URL", DEFAULT_BASE_URL),
        help="Deprecated compatibility option; no local gateway is required.",
    )
    parser.add_argument(
        "--model",
        default=os.environ.get("MEMO_MODEL", DEFAULT_MODEL),
        help="Memo model alias.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit a machine-readable result for Memo's browser tool.",
    )
    return parser


def _headless_for_task(task: str) -> bool:
    """Keep Chromium visible unless headless mode is explicitly enabled."""

    del task
    configured = os.environ.get("MEMO_BROWSER_HEADLESS")
    if configured is None:
        return False
    return configured.strip().casefold() in {"1", "true", "yes", "on"}


def _duckduckgo_request(task: str) -> tuple[str, int] | None:
    """Extract a deterministic DuckDuckGo query and requested result count."""

    match = _DUCKDUCKGO_TASK.search(task)
    if match is None:
        return None

    query = re.split(
        r"\s+(?:and\s+)?(?:give|return|show|list|provide)\b",
        match.group(1),
        maxsplit=1,
        flags=re.IGNORECASE,
    )[0]
    query = query.strip().strip("\"'?. ")
    if not query:
        return None

    count_match = _RESULT_COUNT.search(task)
    count = min(int(count_match.group(1)), 10) if count_match else 5
    return query, count


def _direct_url(duckduckgo_url: str) -> str:
    parsed = urllib.parse.urlparse(duckduckgo_url)
    if parsed.netloc.casefold().endswith("duckduckgo.com"):
        redirect = urllib.parse.parse_qs(parsed.query).get("uddg")
        if redirect:
            return redirect[0]
    return duckduckgo_url


def _search_duckduckgo(query: str, count: int) -> dict[str, object]:
    """Fetch and parse DuckDuckGo's text result page without an LLM decision."""

    encoded = urllib.parse.quote_plus(query)
    url = f"https://r.jina.ai/http://html.duckduckgo.com/html/?q={encoded}"
    request = urllib.request.Request(url, headers={"User-Agent": "Memo/0.1"})
    with urllib.request.urlopen(request, timeout=30) as response:
        page = response.read().decode("utf-8", errors="replace")

    results: list[tuple[str, str]] = []
    seen: set[str] = set()
    for title, result_url in _RESULT_HEADING.findall(page):
        direct_url = _direct_url(html.unescape(result_url))
        if direct_url in seen:
            continue
        seen.add(direct_url)
        clean_title = html.unescape(re.sub(r"[*_`]", "", title)).strip()
        results.append((clean_title, direct_url))
        if len(results) == count:
            break

    if not results:
        raise RuntimeError("DuckDuckGo returned no extractable search results.")

    rendered = [f'DuckDuckGo results for "{query}":']
    rendered.extend(
        f"{index}. [{title}]({result_url})"
        for index, (title, result_url) in enumerate(results, start=1)
    )
    return {
        "ok": True,
        "task": query,
        "result": "\n".join(rendered),
        "urls": [result_url for _, result_url in results],
    }


async def run_agent(task: str, *, base_url: str, model: str):
    """Run Browser Use with Memo's ChatGPT client in the current process."""

    from browser_use import Agent, BrowserProfile

    from .llm import MemoChatModel

    del base_url
    llm = MemoChatModel(
        model=model,
        api_base=os.environ.get("CHATGPT_API_BASE") or None,
    )
    with tempfile.TemporaryDirectory(prefix="memo-browser-profile-") as profile_dir:
        profile = BrowserProfile(
            user_data_dir=profile_dir,
            headless=_headless_for_task(task),
            enable_default_extensions=False,
            chromium_sandbox=False,
            args=[
                "--disable-gpu",
                "--disable-background-networking",
                "--disable-component-update",
                "--no-first-run",
            ],
        )
        return await Agent(
            task=task,
            llm=llm,
            browser_profile=profile,
            use_vision=False,
            extend_system_message=BROWSER_RECOVERY_INSTRUCTIONS,
            use_judge=False,
            enable_signal_handler=False,
        ).run(max_steps=int(os.environ.get("MEMO_BROWSER_MAX_STEPS", "25")))


async def execute_browser_task(
    task: str,
    *,
    base_url: str = DEFAULT_BASE_URL,
    model: str = DEFAULT_MODEL,
) -> dict[str, object]:
    """Execute one browser task from Memo's main Python environment."""

    duckduckgo_request = _duckduckgo_request(task) if _headless_for_task(task) else None
    if duckduckgo_request is not None:
        query, count = duckduckgo_request
        return await asyncio.to_thread(_search_duckduckgo, query, count)

    history = await run_agent(task, base_url=base_url, model=model)
    return {
        "ok": history.is_successful(),
        "task": task,
        "result": history.final_result(),
        "urls": history.urls(),
    }


async def _async_main() -> None:
    load_dotenv(PROJECT_ROOT / ".env")
    args = build_parser().parse_args()
    result = await execute_browser_task(
        args.task,
        base_url=args.base_url,
        model=args.model,
    )
    final_result = result.get("result")
    if args.json:
        print(
            "MEMO_BROWSER_RESULT="
            + json.dumps(result, ensure_ascii=False, separators=(",", ":"))
        )
    elif isinstance(final_result, str) and final_result:
        print(final_result)


def main() -> None:
    asyncio.run(_async_main())


if __name__ == "__main__":
    main()
