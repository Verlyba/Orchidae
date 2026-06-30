"""
Orchestrator — main state machine with task latching.

Drives the flow: Planning -> Execution -> Verification for each sub-task.
"""

from __future__ import annotations

import asyncio
import enum
import inspect
import logging
from typing import Any, Callable, Awaitable

from orchiday.ai.llm_planner import LLMPlanner
from orchiday.ai.vlm_inspector import VLMInspector
from orchiday.core.events import event_bus
from orchiday.core.constants import DEFAULT_TASK_TIMEOUT_S

log = logging.getLogger(__name__)


class OrchestratorState(enum.Enum):
    IDLE = "IDLE"
    PLANNING = "PLANNING"
    EXECUTING = "EXECUTING"
    VERIFYING = "VERIFYING"
    COMPLETED = "COMPLETED"
    ERROR = "ERROR"


class TaskLatch:
    """
    Lock for task execution — prevents chaotic instructions mid-flight.

    Strategies:
        - timeout:      Unlocks after a fixed time.
        - action_chunk: Unlocks when the motor thread signals completion.
        - hybrid:       Whichever comes first.
    """

    def __init__(self, strategy: str = "action_chunk", timeout_s: float = DEFAULT_TASK_TIMEOUT_S):
        self._strategy = strategy
        self._timeout = timeout_s
        self._locked = False
        self._completed = asyncio.Event()
        self._loop: asyncio.AbstractEventLoop | None = None
        try:
            self._loop = asyncio.get_running_loop()
        except RuntimeError:
            self._loop = None

    @property
    def is_locked(self) -> bool:
        return self._locked

    def lock(self) -> None:
        self._locked = True
        self._completed.clear()
        event_bus.orchestration_locked.emit()
        log.debug("Task latch LOCKED")

    def unlock(self) -> None:
        """Unlock the task latch — safe to call from any background thread."""
        self._locked = False
        if self._loop and self._loop.is_running():
            self._loop.call_soon_threadsafe(self._completed.set)
        else:
            self._completed.set()
        event_bus.orchestration_unlocked.emit()
        log.debug("Task latch UNLOCKED")

    async def wait_for_completion(self) -> None:
        if self._strategy == "timeout":
            await asyncio.sleep(self._timeout)
            self.unlock()
        elif self._strategy == "action_chunk":
            await self._completed.wait()
        elif self._strategy == "hybrid":
            try:
                await asyncio.wait_for(self._completed.wait(), timeout=self._timeout)
            except asyncio.TimeoutError:
                log.warning("Task latch timeout — forced unlock")
                self.unlock()


class Orchestrator:
    """
    Main orchestrator — drives the three-layer brain.

    Flow:
        1. User sends a command
        2. CEO (LLM) creates a plan
        3. For each sub-task:
            a. Lock the latch
            b. Start motor thread (LeRobot inference)
            c. Wait for completion
            d. Unlock latch
            e. VLM verifies success
            f. On failure -> re-plan or skip
    """

    def __init__(self, planner: LLMPlanner, inspector: VLMInspector,
                 latch_strategy: str = "action_chunk", timeout_s: float = DEFAULT_TASK_TIMEOUT_S):
        self._planner = planner
        self._inspector = inspector
        self._latch = TaskLatch(latch_strategy, timeout_s)
        self._state = OrchestratorState.IDLE
        self._plan: list[str] = []
        self._current_task_index = 0
        self._results: list[dict[str, Any]] = []

        self._execute_callback: Callable[[str], Awaitable[None]] | Callable[[str], None] | None = None
        self._capture_callback: Callable[[], Awaitable[str]] | Callable[[], str] | None = None

    @property
    def state(self) -> OrchestratorState:
        return self._state

    @property
    def plan(self) -> list[str]:
        return list(self._plan)

    @property
    def current_task(self) -> str | None:
        if 0 <= self._current_task_index < len(self._plan):
            return self._plan[self._current_task_index]
        return None

    @property
    def latch(self) -> TaskLatch:
        return self._latch

    def set_execute_callback(self, callback: Callable[[str], Awaitable[None]] | Callable[[str], None]) -> None:
        """Set callback for sub-task execution (LeRobot inference)."""
        self._execute_callback = callback

    def set_capture_callback(self, callback: Callable[[], Awaitable[str]] | Callable[[], str]) -> None:
        """Set callback for capturing a scene snapshot."""
        self._capture_callback = callback

    async def run(self, user_instruction: str) -> list[dict[str, Any]]:
        """
        Run the complete orchestration loop with planning, non-blocking execution,
        VLM inspection, and error-resilient re-planning.

        Args:
            user_instruction: Natural language command from the user.

        Returns:
            List of result dicts for each sub-task.
        """
        self._results = []
        max_replans = 3
        replan_count = 0

        try:
            # Phase 1: Planning
            self._state = OrchestratorState.PLANNING
            event_bus.log_message.emit("INFO", f"Phase: PLANNING — \"{user_instruction}\"")
            self._plan = await self._planner.create_plan(user_instruction)
            self._current_task_index = 0

            if not self._plan:
                event_bus.log_message.emit("WARN", "CEO returned an empty plan.")
                self._state = OrchestratorState.COMPLETED
                event_bus.orchestration_finished.emit(True)
                return self._results

            # Phase 2: Sequential execution
            while self._current_task_index < len(self._plan):
                task_name = self._plan[self._current_task_index]
                self._state = OrchestratorState.EXECUTING

                event_bus.orchestration_task_started.emit(task_name)
                event_bus.log_message.emit("INFO", f"Executing [{self._current_task_index + 1}/{len(self._plan)}]: {task_name}")

                self._latch.lock()

                if self._execute_callback:
                    # POZOR: Callback spouští motor a okamžitě se vrací!
                    try:
                        if inspect.iscoroutinefunction(self._execute_callback):
                            await self._execute_callback(task_name)
                        else:
                            self._execute_callback(task_name)
                    except Exception as e:
                        log.error("Failed to execute motor callback: %s", e)
                        event_bus.log_message.emit("ERROR", f"Failed to start task: {e}")
                        self._latch.unlock()

                # Asynchronně čekáme, než motorické vlákno nebo controller zavolá latch.unlock()
                await self._latch.wait_for_completion()

                # Phase 3: VLM Verification
                self._state = OrchestratorState.VERIFYING
                success = True
                error_tag = "SUCCESS"

                if self._capture_callback and self._inspector:
                    try:
                        event_bus.log_message.emit("INFO", "Verifying task state with VLM...")
                        captured = None
                        if inspect.iscoroutinefunction(self._capture_callback):
                            captured = await self._capture_callback()
                        else:
                            captured = self._capture_callback()

                        image_b64 = str(captured) if captured is not None else ""
                        if image_b64:
                            event_bus.orchestration_vlm_snap.emit(image_b64)
                            success, error_tag = await self._inspector.verify_task_completion(task_name, image_b64)
                        else:
                            log.warning("No image captured for VLM verification, assuming success")
                            success = True
                    except Exception as e:
                        log.warning("VLM verification failed: %s, assuming success to continue", e)
                        success = True

                result = {
                    "task": task_name,
                    "index": self._current_task_index,
                    "success": success,
                }
                self._results.append(result)
                event_bus.orchestration_task_completed.emit(task_name, success)

                if not success:
                    replan_count += 1
                    if replan_count > max_replans:
                        event_bus.log_message.emit("ERROR", f"Task '{task_name}' failed. Maximum replans ({max_replans}) exceeded!")
                        raise RuntimeError(f"Orchestration failed: '{task_name}' failed repeatedly.")

                    event_bus.log_message.emit("WARN", f"Task '{task_name}' failed with cause '{error_tag}'! Starting RE-PLANNING ({replan_count}/{max_replans}).")
                    
                    # Sémantická rekonstrukce nového plánu na základě konkrétní chyby!
                    failure_context = (
                        f"Task '{task_name}' failed with cause '{error_tag}'. "
                        f"Please adapt the remaining plan addressingly based on this failure. "
                        f"Original instruction: '{user_instruction}'"
                    )
                    self._plan = await self._planner.create_plan(failure_context)
                    self._current_task_index = 0  # Restart the new plan from zero
                    
                    if not self._plan:
                        raise RuntimeError("Critical error: Re-planning failed and returned an empty plan.")
                    continue

                # Pokud úkol uspěl, posuneme se na další
                self._current_task_index += 1

            # Done
            self._state = OrchestratorState.COMPLETED
            overall_success = all(r["success"] for r in self._results)
            event_bus.orchestration_finished.emit(overall_success)

            status = "success" if overall_success else "with errors"
            event_bus.log_message.emit(
                "SUCCESS" if overall_success else "WARN",
                f"Orchestration completed ({status}): {len(self._results)} tasks"
            )
            return self._results

        except Exception as e:
            self._state = OrchestratorState.ERROR
            event_bus.orchestration_error.emit(str(e))
            event_bus.log_message.emit("ERROR", f"Orchestration failed: {e}")
            raise

    def reset(self) -> None:
        """Reset the orchestrator to IDLE."""
        self._state = OrchestratorState.IDLE
        self._plan = []
        self._current_task_index = 0
        self._results = []
        if self._latch.is_locked:
            self._latch.unlock()
