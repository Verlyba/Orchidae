"""
Safety filters for servo motor command protection.

Implements:
- Low-Pass Filter (exponential moving average)
- Slew Rate Limiter (max angle change per frame)
- Watchdog timer
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass

log = logging.getLogger(__name__)


@dataclass
class SafetyConfig:
    """Configuration for safety filters."""
    slew_rate_limit: float = 0.05       # rad/frame max delta
    lowpass_alpha: float = 0.25         # EMA coefficient
    watchdog_timeout_s: float = 5.0     # Max time without response
    num_axes: int = 6


class LowPassFilter:
    """
    Exponential moving average for smoothing policy output.

    output[t] = alpha * input[t] + (1 - alpha) * output[t-1]

    Lower alpha = more smoothing (slower response, smoother motion).
    """

    def __init__(self, alpha: float = 0.25, num_axes: int = 6):
        self._alpha = alpha
        self._prev: list[float] | None = None

    @property
    def alpha(self) -> float:
        return self._alpha

    @alpha.setter
    def alpha(self, value: float) -> None:
        self._alpha = max(0.01, min(1.0, value))

    def filter(self, values: list[float]) -> list[float]:
        """Apply low-pass filter to angle vector."""
        if self._prev is None:
            self._prev = list(values)
            return list(values)

        filtered = []
        for i, v in enumerate(values):
            prev = self._prev[i] if i < len(self._prev) else v
            smooth = self._alpha * v + (1 - self._alpha) * prev
            filtered.append(smooth)

        self._prev = list(filtered)
        return filtered

    def reset(self) -> None:
        """Reset filter state."""
        self._prev = None


class SlewRateLimiter:
    """
    Limits maximum angle change between consecutive frames.

    If the model predicts an anomalous jump, the command is clamped.
    """

    def __init__(self, max_delta: float = 0.05, num_axes: int = 6):
        self._max_delta = max_delta
        self._prev: list[float] | None = None
        self._clipped_count = 0

    @property
    def max_delta(self) -> float:
        return self._max_delta

    @max_delta.setter
    def max_delta(self, value: float) -> None:
        self._max_delta = max(0.001, value)

    @property
    def clipped_count(self) -> int:
        """Number of clipped values since last reset."""
        return self._clipped_count

    def limit(self, values: list[float]) -> list[float]:
        """Apply slew rate limiter to angle vector."""
        if self._prev is None:
            self._prev = list(values)
            return list(values)

        limited = []
        for i, v in enumerate(values):
            prev = self._prev[i] if i < len(self._prev) else v
            delta = v - prev
            if abs(delta) > self._max_delta:
                clamped = prev + self._max_delta * (1 if delta > 0 else -1)
                limited.append(clamped)
                self._clipped_count += 1
                log.warning("Slew rate clipped: axis %d, delta=%.4f > max=%.4f", i, delta, self._max_delta)
            else:
                limited.append(v)

        self._prev = list(limited)
        return limited

    def reset(self) -> None:
        """Reset limiter state."""
        self._prev = None
        self._clipped_count = 0


class Watchdog:
    """
    Watchdog timer — detects unresponsive motor threads.

    If kick() is not called within the timeout, is_expired returns True.
    """

    def __init__(self, timeout_s: float = 5.0):
        self._timeout = timeout_s
        self._last_kick = time.monotonic()
        self._active = False

    def start(self) -> None:
        self._active = True
        self._last_kick = time.monotonic()

    def stop(self) -> None:
        self._active = False

    def kick(self) -> None:
        """Reset watchdog (= 'I am alive')."""
        self._last_kick = time.monotonic()

    @property
    def is_expired(self) -> bool:
        if not self._active:
            return False
        return (time.monotonic() - self._last_kick) > self._timeout

    @property
    def time_remaining(self) -> float:
        if not self._active:
            return float("inf")
        elapsed = time.monotonic() - self._last_kick
        return max(0.0, self._timeout - elapsed)


class SafetyFilterPipeline:
    """
    Complete safety pipeline — applies all filters in order.

    Usage:
        pipeline = SafetyFilterPipeline(SafetyConfig())
        safe_angles = pipeline.process(raw_angles)
    """

    def __init__(self, config: SafetyConfig):
        self._config = config
        self._lowpass = LowPassFilter(config.lowpass_alpha, config.num_axes)
        self._slew = SlewRateLimiter(config.slew_rate_limit, config.num_axes)
        self._watchdog = Watchdog(config.watchdog_timeout_s)

    @property
    def lowpass(self) -> LowPassFilter:
        return self._lowpass

    @property
    def slew_limiter(self) -> SlewRateLimiter:
        return self._slew

    @property
    def watchdog(self) -> Watchdog:
        return self._watchdog

    def process(self, raw_angles: list[float]) -> list[float]:
        """
        Apply safety filters to raw policy angles.

        Order: Low-pass -> Slew rate -> Watchdog kick
        """
        smoothed = self._lowpass.filter(raw_angles)
        limited = self._slew.limit(smoothed)
        self._watchdog.kick()

        try:
            from orchiday.core.events import event_bus
            event_bus.safety_telemetry.emit(raw_angles, limited)
        except Exception:
            pass

        return limited

    def reset(self) -> None:
        """Reset all filters."""
        self._lowpass.reset()
        self._slew.reset()
        self._watchdog.stop()
