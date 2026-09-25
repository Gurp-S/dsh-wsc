from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BRIDGE = ROOT / "python" / "wsc_bridge.py"


def event(seq: int, kind: str, data: dict) -> dict:
    return {"seq": seq, "time": 1_800_000_000_000 + seq, "type": kind, "data": data}


def user_event(seq: int, text: str) -> dict:
    return event(seq, "user/message", {"id": f"m{seq}", "role": "user", "content": [{"type": "text", "text": text}]})


def assistant_event(seq: int, text: str) -> dict:
    return event(seq, "assistant/message", {"message": {"id": f"m{seq}", "role": "assistant", "content": [{"type": "text", "text": text}]}})


class WscBridgeTests(unittest.TestCase):
    def invoke(self, request: dict) -> dict:
        completed = subprocess.run(
            [sys.executable, str(BRIDGE)],
            input=json.dumps(request).encode("utf-8"),
            capture_output=True,
            cwd=ROOT,
            check=False,
            timeout=60,
        )
        if completed.returncode:
            self.fail(f"bridge exited with {completed.returncode}: {completed.stderr.decode('utf-8', 'replace')}")
        return json.loads(completed.stdout.decode("utf-8"))

    def test_v1_emits_deterministic_projection_and_roundtrips_state(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            cwd = Path(temp)
            events = []
            for index in range(36):
                events.append(user_event(index * 2, f"Implement feature {index}: preserve the current behavior and report the exact verification result. " * 4))
                events.append(assistant_event(index * 2 + 1, f"The implementation inspected module_{index}.py and retained the validated behavior. " * 14))
            request = {
                "implementation": "v1",
                "sessionId": "bridge-v1-test",
                "cwd": str(cwd),
                "events": events,
                "viewPath": str(cwd / ".xeyo_offload" / "dsh-wsc" / "view.txt"),
                "viewRef": ".xeyo_offload/dsh-wsc/view.txt",
            }
            first = self.invoke(request)
            self.assertTrue(first["compressed"], first.get("reason"))
            self.assertIn("[", first["text"])
            self.assertTrue(Path(request["viewPath"]).is_file())

            request["state"] = first["state"]
            request["events"].extend([
                user_event(72, "The next request is to add a regression check while preserving the current output."),
                assistant_event(73, "The regression check is prepared and the output remains deterministic."),
            ])
            second = self.invoke(request)
            self.assertTrue(second["compressed"], second.get("reason"))
            self.assertIsInstance(second["state"]["prev"]["full_text"], str)

    def test_v2_replays_tool_and_request_events_deterministically(self) -> None:
        messages = [user_event(1, "Fix parser.py and preserve the CLI contract.")]
        messages.append(event(2, "assistant/message", {"message": {
            "id": "m2", "role": "assistant", "content": [{
                "type": "tool-call", "id": "call-1", "name": "read",
                "arguments": json.dumps({"file_path": "src/parser.py", "offset": 1, "limit": 30}),
            }],
        }}))
        messages.append(event(3, "tool/result", {"message": {
            "id": "m3", "role": "user", "content": [{
                "type": "tool-result", "toolCallId": "call-1", "isError": True,
                "content": [{"type": "text", "text": "Permission denied: src/parser.py"}],
            }],
        }}))
        request = {"implementation": "v2", "events": messages}
        first = self.invoke(request)
        second = self.invoke(request)
        self.assertTrue(first["compressed"], first.get("reason"))
        self.assertEqual(first["text"], second["text"])
        self.assertIn("CURRENT REQUEST", first["text"])
        self.assertIn("UNRESOLVED", first["text"])


if __name__ == "__main__":
    unittest.main()
