#!/usr/bin/env python3
"""Long-lived fb-idb gRPC client. JSON lines on stdin/stdout. Companion stays up."""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import sys
from typing import Any

logging.disable(logging.CRITICAL)


def _out(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, separators=(",", ":")) + "\n")
    sys.stdout.flush()


async def _handle(client: Any, req: dict[str, Any]) -> dict[str, Any]:
    op = req.get("op")
    if op == "describe-all":
        from idb.common.types import AccessibilityInfoOptions

        info = await client.accessibility_info(
            target=None,
            options=AccessibilityInfoOptions(nested=True),
        )
        raw = info.json
        return {"stdout": raw if isinstance(raw, str) else json.dumps(raw)}
    if op == "tap":
        await client.tap(float(req["x"]), float(req["y"]))
        return {}
    if op == "text":
        await client.text(str(req["text"]))
        return {}
    if op == "screenshot":
        shot = await client.screenshot()
        return {"b64": base64.b64encode(bytes(shot)).decode("ascii")}
    if op == "key":
        keycode = int(req["keycode"])
        if req.get("command"):
            from idb.common.hid import (
                iterator_to_async_iterator,
                key_press_with_modifiers_to_events,
            )

            events = key_press_with_modifiers_to_events(
                keycode=keycode, modifiers=["command"]
            )
            await client.hid(iterator_to_async_iterator(events))
        else:
            await client.key(keycode=keycode)
        return {}
    if op == "set-value":
        from idb.common.types import AccessibilityPoint

        await client.accessibility_set_value(
            AccessibilityPoint(x=float(req["x"]), y=float(req["y"])),
            str(req.get("value") or ""),
        )
        return {}
    if op == "swipe":
        await client.swipe(
            (int(req["x1"]), int(req["y1"])),
            (int(req["x2"]), int(req["y2"])),
        )
        return {}
    if op == "terminate":
        await client.terminate(str(req["bundle"]))
        return {}
    if op == "uninstall":
        await client.uninstall(str(req["bundle"]))
        return {}
    if op == "launch":
        await client.launch(str(req["bundle"]))
        return {}
    if op == "install":
        async for _ in client.install(str(req["path"])):
            pass
        return {}
    if op == "ping":
        return {}
    raise ValueError(f"unknown op {op!r}")


async def _run() -> int:
    udid = os.environ.get("IDB_UDID") or (sys.argv[1] if len(sys.argv) > 1 else None)
    try:
        from idb.cli.command_tree import get_default_companion_path
        from idb.grpc.management import ClientManager
    except Exception as err:
        _out({"ok": False, "ready": False, "error": f"fb-idb python client missing: {err}"})
        return 1

    companion_path = get_default_companion_path()
    manager = ClientManager(
        companion_path=companion_path,
        prune_dead_companion=False,
        logger=logging.getLogger("convoy-idb"),
    )
    try:
        async with manager.from_udid(udid=udid) as client:
            _out({"ok": True, "ready": True})
            loop = asyncio.get_running_loop()
            while True:
                line = await loop.run_in_executor(None, sys.stdin.readline)
                if not line:
                    break
                line = line.strip()
                if not line:
                    continue
                try:
                    req = json.loads(line)
                except json.JSONDecodeError as err:
                    _out({"ok": False, "error": f"bad json: {err}"})
                    continue
                req_id = req.get("id")
                try:
                    result = await _handle(client, req)
                    _out({"id": req_id, "ok": True, **result})
                except Exception as err:
                    _out({"id": req_id, "ok": False, "error": str(err)})
    except Exception as err:
        _out({"ok": False, "ready": False, "error": str(err)})
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_run()))
