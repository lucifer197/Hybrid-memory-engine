"""Minimal in-process circuit breaker (closed / open / half-open)."""

import time
from typing import Callable, TypeVar

T = TypeVar("T")


class CircuitBreakerOpenError(Exception):
    def __init__(self, name: str):
        super().__init__(f"Circuit breaker '{name}' is open")
        self.breaker_name = name


class CircuitBreaker:
    def __init__(
        self,
        name: str,
        failure_threshold: int = 5,
        reset_timeout_sec: float = 30.0,
    ):
        self.name = name
        self.failure_threshold = failure_threshold
        self.reset_timeout_sec = reset_timeout_sec

        self._state: str = "closed"  # closed | open | half-open
        self._failure_count: int = 0
        self._last_failure_time: float = 0.0

    @property
    def state(self) -> str:
        if self._state == "open":
            if time.monotonic() - self._last_failure_time >= self.reset_timeout_sec:
                self._state = "half-open"
        return self._state

    def execute(self, fn: Callable[[], T]) -> T:
        current = self.state

        if current == "open":
            raise CircuitBreakerOpenError(self.name)

        try:
            result = fn()
            self._on_success()
            return result
        except Exception:
            self._on_failure()
            raise

    def _on_success(self) -> None:
        self._failure_count = 0
        self._state = "closed"

    def _on_failure(self) -> None:
        self._failure_count += 1
        self._last_failure_time = time.monotonic()
        if self._failure_count >= self.failure_threshold:
            self._state = "open"

    def reset(self) -> None:
        self._state = "closed"
        self._failure_count = 0
        self._last_failure_time = 0.0
