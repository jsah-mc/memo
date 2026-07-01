import json
from pathlib import Path
from typing import Any
from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_ollama import ChatOllama
from langchain_core.messages import HumanMessage


class AI:
    def __init__(
        self,
        model_name: str = "gemma4",
        temperature: float = 0.0,
        config_path: str = "./mcp.json",
    ):
        self.model = ChatOllama(model=model_name, temperature=temperature)
        self.config_path = Path(config_path)

    def _load_all_server_configs(self) -> dict:
        if not self.config_path.exists():
            raise FileNotFoundError(f"Config file not found at {self.config_path}")

        with open(self.config_path, "r") as f:
            config = json.load(f)

        servers = config.get("mcpServers", {})
        if not servers:
            raise ValueError(f"No mcpServers configuration found in {self.config_path}")

        formatted_connections = {}
        for name, cfg in servers.items():
            formatted_connections[name] = {
                "command": cfg["command"],
                "args": cfg.get("args", []),
                "transport": cfg.get("transport", "stdio"),
            }
        return formatted_connections

    async def ask(self, prompt: str) -> str:
        connections = self._load_all_server_configs()

        async with MultiServerMCPClient(connections) as mcp_client:
            mcp_tools = await mcp_client.get_tools()
            model_with_tools = self.model.bind_tools(mcp_tools)

            response = await model_with_tools.ainvoke([HumanMessage(content=prompt)])
            return self._parse_response(response)

    def _parse_response(self, response: Any) -> str:
        if response.tool_calls:
            result = "[Tool Call Triggered]\n"
            for tool_call in response.tool_calls:
                result += f"Tool: {tool_call['name']}\nArguments: {tool_call['args']}\n"
            return result.strip()
        return response.content
