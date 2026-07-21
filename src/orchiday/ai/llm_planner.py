"""
LLM Planner — Model 1 (CEO).

Decomposes user instructions into an ordered array of sub-tasks
using an LLM running in LM Studio.
"""

from __future__ import annotations

import logging
from typing import Any

from orchiday.ai.lm_studio_client import LMStudioClient
from orchiday.core.constants import DEFAULT_LLM_SYSTEM_PROMPT
from orchiday.core.events import event_bus

log = logging.getLogger(__name__)


class LLMPlanner:
    """
    Model 1: CEO — high-level task decomposition.

    Takes a user instruction and returns a structured plan
    as a list of sub-task identifiers.
    """

    def __init__(self, client: LMStudioClient, model_name: str = "local-llm",
                 system_prompt: str = DEFAULT_LLM_SYSTEM_PROMPT,
                 available_skills: list[str] | None = None,
                 skills_details: dict[str, Any] | None = None,
                 scene_description: str = ""):
        self._client = client
        self._model = model_name
        self._system_prompt = system_prompt
        self._available_skills = available_skills or []
        self._skills_details = skills_details or {}
        self._scene_description = scene_description or ""

    @property
    def model_name(self) -> str:
        return self._model

    @model_name.setter
    def model_name(self, name: str) -> None:
        self._model = name

    def set_available_skills(self, skills: list[str]) -> None:
        """Update the list of available skills for planning."""
        self._available_skills = skills

    def set_skills_details(self, details: dict[str, Any]) -> None:
        """Update the skill details dictionary."""
        self._skills_details = details

    def set_scene_description(self, description: str) -> None:
        """Update the physical scene description used as prompt grounding."""
        self._scene_description = description or ""

    def _build_system_prompt(self) -> str:
        prompt = self._system_prompt
        if self._scene_description:
            prompt += (
                f"\n\nScene description (physical setup of the robot's workspace, "
                f"cameras and objects — always true regardless of the task):\n"
                f"{self._scene_description}"
            )
        if self._available_skills:
            skills_list_str = []
            for s in self._available_skills:
                detail = self._skills_details.get(s, {})
                name = detail.get("name", s)
                desc = detail.get("description", "")
                parent = detail.get("parent_slug")
                hierarchy = f" (Sub-step of parent: '{parent}')" if parent else " (High-level Goal/Skill)"
                
                skill_info = f"- ID: '{s}' | Name: '{name}'{hierarchy}"
                if desc:
                    skill_info += f"\n  Description: {desc}"
                skills_list_str.append(skill_info)
                
            prompt += (
                f"\n\nAvailable robot skills/goals:\n" +
                "\n".join(skills_list_str) +
                "\n\nUse ONLY the valid skill/step IDs in your plan."
            )
        return prompt

    async def create_plan(self, user_instruction: str) -> list[str]:
        """
        Decompose user instruction into a list of sub-tasks.

        Args:
            user_instruction: Natural language command (e.g. "Clean the table").

        Returns:
            List of sub-task identifiers: ["pick_cube", "move_to_bowl"].

        Raises:
            ValueError: If the model does not return a valid JSON array.
        """
        event_bus.log_message.emit("INFO", f"CEO planning: \"{user_instruction}\"")

        response = await self._client.chat(
            model=self._model,
            messages=[
                {"role": "system", "content": self._build_system_prompt()},
                {"role": "user", "content": user_instruction},
            ],
            temperature=0.1, max_tokens=512,
        )

        parsed = await self._client.parse_json_response(response)

        if isinstance(parsed, list) and all(isinstance(s, str) for s in parsed):
            plan = parsed
        else:
            log.error("CEO model did not return a valid plan: %s", response)
            raise ValueError(f"Invalid model response: {response}")

        event_bus.orchestration_plan_ready.emit(plan)
        event_bus.log_message.emit("SUCCESS", f"Plan created: {plan}")
        return plan
