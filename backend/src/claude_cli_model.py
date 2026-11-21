"""LLM provider that runs prompts through the local Claude app (`claude -p`).

Select it with ``LLM=claude:sonnet`` (or ``claude:haiku`` / ``claude:opus``). It uses
whatever account the ``claude`` CLI is signed in to, so no API key is needed.
Structured output works by asking for a JSON tool call, which pydantic-ai validates
and retries like any other model.
"""

import asyncio
import json
import os
import re
import shutil
from pathlib import Path

from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    RetryPromptPart,
    SystemPromptPart,
    TextPart,
    ToolCallPart,
    ToolReturnPart,
    UserPromptPart,
)
from pydantic_ai.models.function import AgentInfo, FunctionModel

TIMEOUT_SECONDS = int(os.getenv("CLAUDE_CLI_TIMEOUT_SECONDS", "900"))
# One `claude` process at a time per slot keeps long videos from flooding the account.
_SLOTS = asyncio.Semaphore(int(os.getenv("CLAUDE_CLI_CONCURRENCY", "3")))


def claude_cli_path() -> str | None:
    configured = os.getenv("CLAUDE_CLI_BIN", "").strip()
    if configured and Path(configured).exists():
        return configured
    return shutil.which("claude") or next(
        (str(p) for p in (Path.home() / ".local/bin/claude", Path("/opt/homebrew/bin/claude"), Path("/usr/local/bin/claude")) if p.exists()),
        None,
    )


def _text_of(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, (list, tuple)):
        return "\n".join(part if isinstance(part, str) else getattr(part, "content", "") or "" for part in content if isinstance(part, str) or hasattr(part, "content"))
    return str(content)


def _render(messages: list[ModelMessage]) -> str:
    chunks: list[str] = []
    for message in messages:
        if isinstance(message, ModelRequest):
            for part in message.parts:
                if isinstance(part, SystemPromptPart):
                    chunks.append(f"### SYSTEM\n{part.content}")
                elif isinstance(part, UserPromptPart):
                    chunks.append(f"### USER\n{_text_of(part.content)}")
                elif isinstance(part, ToolReturnPart):
                    chunks.append(f"### TOOL RESULT ({part.tool_name})\n{_text_of(part.content)}")
                elif isinstance(part, RetryPromptPart):
                    chunks.append(f"### YOUR PREVIOUS ANSWER WAS REJECTED\n{_text_of(part.content)}\nReturn a corrected answer.")
        elif isinstance(message, ModelResponse):
            for part in message.parts:
                if isinstance(part, TextPart):
                    chunks.append(f"### ASSISTANT\n{part.content}")
                elif isinstance(part, ToolCallPart):
                    chunks.append(f"### ASSISTANT CALLED {part.tool_name}\n{part.args if isinstance(part.args, str) else json.dumps(part.args)}")
    return "\n\n".join(chunks)


def _extract_json(text: str):
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fence:
        text = fence.group(1).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start < 0 or end <= start:
            raise
        return json.loads(text[start : end + 1])


async def _run_claude(prompt: str, model: str) -> str:
    binary = claude_cli_path()
    if not binary:
        raise RuntimeError("LLM is claude:*, but the `claude` CLI was not found. Install Claude Code and sign in, or set CLAUDE_CLI_BIN.")
    async with _SLOTS:
        process = await asyncio.create_subprocess_exec(
            binary, "-p", "--model", model, "--tools", "", "--no-session-persistence",
            "--disable-slash-commands", "--setting-sources", "", "--strict-mcp-config",
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(prompt.encode()), TIMEOUT_SECONDS)
        except asyncio.TimeoutError:
            process.kill()
            raise RuntimeError(f"claude CLI timed out after {TIMEOUT_SECONDS}s")
        except asyncio.CancelledError:
            process.kill()
            raise
    if process.returncode != 0:
        raise RuntimeError(f"claude CLI failed: {stderr.decode().strip()[:300] or process.returncode}")
    return stdout.decode().strip()


def build_claude_cli_model(model: str = "sonnet") -> FunctionModel:
    async def respond(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        prompt = _render(messages)
        tools = list(info.output_tools) + (list(info.function_tools) if info.output_tools else [])
        if not tools:
            return ModelResponse(parts=[TextPart(await _run_claude(prompt, model))])

        specs = [{"name": t.name, "description": t.description, "parameters": t.parameters_json_schema} for t in tools]
        prompt += (
            "\n\n### INSTRUCTIONS\nAnswer by calling exactly one of the functions below. Reply with ONLY a JSON object "
            '{"name": <function name>, "arguments": {...}} whose arguments satisfy that function\'s JSON schema. '
            "No prose, no code fences.\n" + json.dumps(specs)
        )
        raw = await _run_claude(prompt, model)
        try:
            data = _extract_json(raw)
        except (json.JSONDecodeError, ValueError):
            # Let pydantic-ai see a plain-text reply and retry with its own error message.
            return ModelResponse(parts=[TextPart(raw)])
        if not isinstance(data, dict) or "name" not in data:
            data = {"name": tools[0].name, "arguments": data}
        arguments = data.get("arguments", {})
        return ModelResponse(parts=[ToolCallPart(tool_name=str(data["name"]), args=arguments)])

    return FunctionModel(respond, model_name=f"claude-cli:{model}")
