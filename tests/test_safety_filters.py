"""
Testy pro bezpečnostní filtry.
"""

import time
import sys
import os

# Přidat src do cesty
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from orchiday.hardware.safety_filters import (
    LowPassFilter,
    SlewRateLimiter,
    Watchdog,
    SafetyFilterPipeline,
    SafetyConfig,
)


def test_lowpass_filter_smoothing():
    """Low-pass filtr by měl vyhlazovat prudké změny."""
    lpf = LowPassFilter(alpha=0.25, num_axes=2)

    # První vzorek se vrátí beze změny
    result = lpf.filter([0.0, 0.0])
    assert result == [0.0, 0.0], f"Expected [0.0, 0.0], got {result}"

    # Prudký skok na 1.0 — filtr by měl vrátit jen 0.25
    result = lpf.filter([1.0, 1.0])
    assert abs(result[0] - 0.25) < 0.001, f"Expected ~0.25, got {result[0]}"
    assert abs(result[1] - 0.25) < 0.001, f"Expected ~0.25, got {result[1]}"

    # Po více iteracích konverguje k 1.0
    for _ in range(20):
        result = lpf.filter([1.0, 1.0])
    assert abs(result[0] - 1.0) < 0.01, f"Expected ~1.0, got {result[0]}"

    print("✅ test_lowpass_filter_smoothing PASSED")


def test_lowpass_filter_reset():
    """Reset by měl vymazat historii."""
    lpf = LowPassFilter(alpha=0.25, num_axes=1)
    lpf.filter([0.0])
    lpf.filter([1.0])
    lpf.reset()

    # Po resetu se první vzorek vrátí beze změny
    result = lpf.filter([0.5])
    assert result == [0.5], f"Expected [0.5], got {result}"

    print("✅ test_lowpass_filter_reset PASSED")


def test_slew_rate_limiter():
    """Slew rate limiter by měl ořezat prudké skoky."""
    srl = SlewRateLimiter(max_delta=0.05, num_axes=1)

    result = srl.limit([0.0])
    assert result == [0.0]

    # Skok o 0.5 — měl by být oříznut na 0.05
    result = srl.limit([0.5])
    assert abs(result[0] - 0.05) < 0.001, f"Expected ~0.05, got {result[0]}"
    assert srl.clipped_count == 1

    # Malý skok (0.03) — měl by projít
    srl_small = SlewRateLimiter(max_delta=0.05, num_axes=1)
    srl_small.limit([0.0])
    result = srl_small.limit([0.03])
    assert abs(result[0] - 0.03) < 0.001, f"Expected ~0.03, got {result[0]}"
    assert srl_small.clipped_count == 0

    print("✅ test_slew_rate_limiter PASSED")


def test_watchdog():
    """Watchdog by měl detekovat timeout."""
    wd = Watchdog(timeout_s=0.1)

    assert not wd.is_expired, "Watchdog neměl být expirovaný (neaktivní)"

    wd.start()
    assert not wd.is_expired, "Watchdog neměl být expirovaný (právě spuštěn)"

    # Počkat až expiruje
    time.sleep(0.15)
    assert wd.is_expired, "Watchdog měl být expirovaný"

    # Kick by měl resetovat
    wd.kick()
    assert not wd.is_expired, "Watchdog neměl být expirovaný (po kick)"

    wd.stop()
    time.sleep(0.15)
    assert not wd.is_expired, "Watchdog neměl být expirovaný (zastaven)"

    print("✅ test_watchdog PASSED")


def test_pipeline():
    """Celý pipeline by měl filtrovat a kicknout watchdog."""
    config = SafetyConfig(
        slew_rate_limit=0.1,
        lowpass_alpha=0.5,
        watchdog_timeout_s=5.0,
        num_axes=3,
    )
    pipeline = SafetyFilterPipeline(config)
    pipeline.watchdog.start()

    # První průchod
    result = pipeline.process([0.0, 0.0, 0.0])
    assert len(result) == 3

    # Prudký skok — měl by být vyhlazený a oříznutý
    result = pipeline.process([1.0, 1.0, 1.0])
    # Po low-pass (alpha=0.5): [0.5, 0.5, 0.5]
    # Slew rate (0.1): [0.1, 0.1, 0.1] — oříznut z 0.5 na 0.1
    assert all(abs(v) <= 0.15 for v in result), f"Expected <=0.15, got {result}"

    # Watchdog by neměl být expirovaný (process volá kick)
    assert not pipeline.watchdog.is_expired

    print("✅ test_pipeline PASSED")


if __name__ == "__main__":
    test_lowpass_filter_smoothing()
    test_lowpass_filter_reset()
    test_slew_rate_limiter()
    test_watchdog()
    test_pipeline()
    print("\n🎉 Všechny testy prošly!")
