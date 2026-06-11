"""
VLM Inspector — Model 2 (Mid-level).

Verifies visual scene state using a VLM running in LM Studio.
"""

from __future__ import annotations

import logging

from orchiday.ai.lm_studio_client import LMStudioClient
from orchiday.core.events import event_bus

log = logging.getLogger(__name__)


class VLMInspector:
    """
    Model 2: Inspector — visual verification.

    Captures a scene image, sends it to a VLM, and evaluates
    whether a sub-task completed successfully.
    """

    def __init__(self, client: LMStudioClient, model_name: str = "local-vlm",
                 skills_details: dict[str, Any] | None = None):
        self._client = client
        self._model = model_name
        self._skills_details = skills_details or {}

    @property
    def model_name(self) -> str:
        return self._model

    @model_name.setter
    def model_name(self, name: str) -> None:
        self._model = name

    def set_skills_details(self, details: dict[str, Any]) -> None:
        """Update the skill details dictionary."""
        self._skills_details = details

    async def verify_task_completion(self, task_name: str, image_base64: str,
                                     expected_state: str | None = None) -> tuple[bool, str]:
        """
        Verify whether a sub-task completed successfully.

        Args:
            task_name: Sub-task name (e.g. "pick_up_cube").
            image_base64: Base64-encoded scene snapshot.
            expected_state: Description of expected state (optional).

        Returns:
            Tuple of (success_boolean, error_tag_string).
        """
        # Retrieve the user description as the expected state if not explicitly passed
        if not expected_state and task_name in self._skills_details:
            expected_state = self._skills_details[task_name].get("description", "")
        prompt = self._build_verification_prompt(task_name, expected_state)
        event_bus.log_message.emit("INFO", f"VLM verifying: {task_name}")

        response = await self._client.chat_with_image(
            model=self._model, prompt=prompt, image_base64=image_base64, temperature=0.1,
        )

        success, error_tag = self._parse_verification(response)
        level = "SUCCESS" if success else "WARN"
        status_msg = "success" if success else f"failure ({error_tag})"
        event_bus.log_message.emit(level, f"VLM result ({task_name}): {status_msg}")
        return success, error_tag

    async def describe_scene(self, image_base64: str) -> str:
        """Ask the VLM to describe the current scene."""
        return await self._client.chat_with_image(
            model=self._model,
            prompt="Briefly describe what you see on the robot's workspace. Focus on object positions.",
            image_base64=image_base64, temperature=0.3,
        )

    async def check_object_state(self, image_base64: str, query: str) -> str:
        """Generic scene query (e.g. 'Is the cube in the bowl?')."""
        response = await self._client.chat_with_image(
            model=self._model, prompt=query, image_base64=image_base64, temperature=0.1,
        )
        return response.strip()

    def _build_verification_prompt(self, task_name: str, expected_state: str | None) -> str:
        prompt = (
            f"The robotic task '{task_name}' just ran. "
            "Look at the image and evaluate if the task completed successfully. "
            "Respond with EXACTLY one of the following strings:\n"
            "- \"SUCCESS\" if the task completed successfully.\n"
            "- \"[cube_missed]\" if the robot missed the cube or target object entirely.\n"
            "- \"[cube_slipped]\" if the robot grabbed the cube but it slipped or fell out of the gripper.\n"
            "- \"[bowl_moved]\" if the target bowl or container has been moved or displaced.\n"
            "- \"[unknown_failure]\" if the task failed due to any other reason.\n"
            "Do not write any other text, respond only with the tag."
        )
        if expected_state:
            prompt += f"\nExpected state: {expected_state}"
        return prompt

    def _parse_verification(self, response: str) -> tuple[bool, str]:
        cleaned = response.strip().upper()
        if "SUCCESS" in cleaned:
            return True, "SUCCESS"
        for tag in ["[CUBE_MISSED]", "[CUBE_SLIPPED]", "[BOWL_MOVED]", "[UNKNOWN_FAILURE]"]:
            if tag in cleaned:
                return False, tag.lower()
        return False, "[unknown_failure]"
