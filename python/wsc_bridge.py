"""JSON bridge from the DSH host plugin to the vendored XEYO WSC cores."""

from __future__ import annotations

import dataclasses
import json
import sys
from pathlib import Path
from typing import Any

PYTHON_ROOT = Path(__file__).resolve().parent
if str(PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(PYTHON_ROOT))
if hasattr(sys.stdin, "reconfigure"):
    sys.stdin.reconfigure(encoding="utf-8")
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")


def _content_text(blocks: Any) -> str:
    if isinstance(blocks, str):
        return blocks
    if not isinstance(blocks, list):
        return ""
    parts = []
    for block in blocks:
        if isinstance(block, dict) and block.get("type") == "text":
            parts.append(str(block.get("text") or ""))
        elif isinstance(block, str):
            parts.append(block)
    return "\n".join(part for part in parts if part)


def _parse_arguments(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if not isinstance(raw, str):
        return {}
    try:
        value = json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        return {"_raw": raw}
    return value if isinstance(value, dict) else {}


def _normalize_block(block: Any) -> dict[str, Any] | None:
    if not isinstance(block, dict):
        return None
    kind = block.get("type")
    if kind == "text":
        return {"type": "text", "text": str(block.get("text") or "")}
    if kind == "reasoning":
        return {"type": "thinking", "thinking": str(block.get("text") or "")}
    if kind == "tool-call":
        return {
            "type": "tool_use",
            "id": str(block.get("id") or ""),
            "name": str(block.get("name") or ""),
            "input": _parse_arguments(block.get("arguments")),
        }
    if kind == "tool-result":
        return {
            "type": "tool_result",
            "tool_use_id": str(block.get("toolCallId") or ""),
            "content": [
                item for item in (_normalize_block(inner) for inner in block.get("content", []))
                if item is not None
            ],
            "is_error": bool(block.get("isError")),
        }
    if kind == "image":
        return {"type": "image"}
    return None


def _message_for_event(event: dict[str, Any]) -> dict[str, Any] | None:
    kind = event.get("type")
    data = event.get("data") or {}
    if kind == "user/message":
        message = data
    elif kind in ("assistant/message", "tool/result"):
        message = data.get("message") or {}
    else:
        return None
    role = str(message.get("role") or "")
    content = [
        item for item in (_normalize_block(block) for block in message.get("content", []))
        if item is not None
    ]
    return {"role": role, "content": content, "ts": float(event.get("time") or 0) / 1000.0}


def _state_to_dict(state: Any) -> dict[str, Any]:
    return dataclasses.asdict(state)


def _state_from_dict(raw: dict[str, Any]):
    from synaptic.assemble import AssemblyState, SegStat
    from synaptic.types import FileState, PruneCard

    data = dict(raw)
    data["seg_stats"] = {
        str(key): SegStat(
            obs=int(value.get("obs", 0)),
            changed=int(value.get("changed", 0)),
            front_break=int(value.get("front_break", 0)),
        )
        for key, value in (data.get("seg_stats") or {}).items()
    }
    for name in ("frozen_cards",):
        cards = []
        for item in data.get(name) or ():
            value = dict(item)
            value["files"] = tuple(value.get("files") or ())
            value["nodes"] = tuple(int(x) for x in value.get("nodes") or ())
            cards.append(PruneCard(**value))
        data[name] = tuple(cards)
    file_states = []
    for item in data.get("frozen_file_states") or ():
        value = dict(item)
        value["read_ranges"] = tuple(tuple(int(y) for y in x) for x in value.get("read_ranges") or ())
        value["related_errors"] = tuple(value.get("related_errors") or ())
        file_states.append(FileState(**value))
    data["frozen_file_states"] = tuple(file_states)
    for name in ("appended", "seg_order", "churn_warn", "frozen_kept", "frozen_pruned", "rehydration_nodes"):
        data[name] = tuple(data.get(name) or ())
    data["journal"] = tuple(tuple(str(y) for y in x) for x in data.get("journal") or ())
    data["rehydration_leases"] = tuple(tuple(x) for x in data.get("rehydration_leases") or ())
    return AssemblyState(**data)


def _v1(request: dict[str, Any]) -> dict[str, Any]:
    from memory.wsc_projection import production_params
    from synaptic.coldstore import ColdStore
    from synaptic.project import project
    from synaptic.textutil import message_text, node_token_len

    messages = [message for event in request.get("events", ()) if (message := _message_for_event(event)) is not None]
    if not messages:
        return {"compressed": False, "reason": "WSC V1 received no source messages"}
    prev = None
    cold = None
    state = request.get("state")
    if isinstance(state, dict):
        try:
            prev = _state_from_dict(state["prev"])
            cold = ColdStore.from_json(state["cold"])
        except (KeyError, TypeError, ValueError):
            # The DSH append-only log is authoritative; an invalid cache is disposable.
            prev = None
            cold = None

    view_path = request.get("viewPath")
    if not view_path:
        return {"compressed": False, "reason": "WSC V1 requires a session workspace for Read handles"}
    cwd = request.get("cwd")
    view_ref = str(request.get("viewRef") or view_path)
    baseline = sum(node_token_len(message_text(message)) for message in messages)
    projection = project(
        messages,
        region_end=len(messages),
        params=production_params(),
        prev=prev,
        cold=cold,
        session=str(request.get("sessionId") or "dsh"),
        region_baseline_tokens=baseline,
        view_path=Path(view_path),
        view_ref=view_ref,
    )
    if not projection.result.compressed:
        return {
            "compressed": False,
            "reason": "WSC V1 declined the projection because the measured gain was below its configured floor",
        }
    if not projection.text.strip():
        return {"compressed": False, "reason": "WSC V1 emitted an empty projection"}
    return {
        "compressed": True,
        "text": projection.text,
        "state": {
            "prev": _state_to_dict(projection.state),
            "cold": projection.cold.to_json(),
        },
    }


def _v2(request: dict[str, Any]) -> dict[str, Any]:
    from memory.wsc2.events import build_events
    from memory.wsc2.projector import render
    from memory.wsc2.reducer import StateReducer
    from memory.wsc2.state import WorkingState

    messages = [message for event in request.get("events", ()) if (message := _message_for_event(event)) is not None]
    if not messages:
        return {"compressed": False, "reason": "WSC V2 received no source messages"}
    events = build_events(messages)
    state = WorkingState()
    reducer = StateReducer()
    for event in events:
        reducer.apply(state, event)
    current_turn = max((event.turn for event in events), default=None)
    text = render(state, current_turn=current_turn)
    return {"compressed": bool(text.strip()), "text": text, "reason": "WSC V2 emitted no canonical state" if not text.strip() else ""}


def main() -> int:
    try:
        request = json.load(sys.stdin)
        implementation = request.get("implementation")
        if implementation == "v1":
            response = _v1(request)
        elif implementation == "v2":
            response = _v2(request)
        else:
            raise ValueError("implementation must be v1 or v2")
        sys.stdout.write(json.dumps(response, ensure_ascii=False, separators=(",", ":")))
        return 0
    except Exception as error:  # The Node host turns this into a durable failed compaction.
        sys.stderr.write(f"{type(error).__name__}: {error}\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
