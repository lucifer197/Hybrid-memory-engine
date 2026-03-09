"""Embedding Worker entry point.

Usage:
    python -m src.main
"""
from src.queue.consumer import consume_loop
from src.health import start_health_server
from src.logger import create_logger

log = create_logger("main")


def main():
    port = start_health_server()
    log.info("starting", health_port=port)
    consume_loop()


if __name__ == "__main__":
    main()
