import asyncio
from typing import Coroutine, Any
import threading

class AsyncRunner:
    """
    A utility to run async functions within a sync context (like Celery tasks)
    by managing a single, reusable event loop per thread.
    """
    _loops = threading.local()

    @classmethod
    def get_loop(cls) -> asyncio.AbstractEventLoop:
        """
        Gets the current event loop for the thread, or creates a new one if it
        doesn't exist or is closed.
        """
        if not hasattr(cls._loops, "loop") or cls._loops.loop.is_closed():
            cls._loops.loop = asyncio.new_event_loop()
            asyncio.set_event_loop(cls._loops.loop)
        return cls._loops.loop

    @classmethod
    def run(cls, coro: Coroutine) -> Any:
        """
        Runs a coroutine on the managed event loop for the current thread.
        """
        loop = cls.get_loop()
        return loop.run_until_complete(coro)