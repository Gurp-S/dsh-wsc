# XEYO WSC for DeepSeek Harness

A deterministic, model-free compaction backend for DeepSeek Harness `0.1.1-rc.2`. It vendors the XEYO WSC V1 and V2 cores and uses the Harness's own compaction transaction, token meter, checkpoint framing, surface replacement, and tool-pairing checks.

This Harness release puts the compaction backend in an **agent preset**, not in the host profile. The included `preset/` is a complete copy of the shipped `standard` preset for `0.1.1-rc.2`, with its `compaction-basic` row changed to this plugin. Do not edit the deployment's shipped preset in place.

## Implementations

- `v1` runs XEYO's production V1 projection (`closure`, `econ`, `Medium+`, `Read` handles), including its persistent AssemblyState and ColdStore. State is committed only after the Harness records a successful compaction. Readable cold views are written under `.xeyo_offload/dsh-wsc/` in the session workspace.
- `v2` rebuilds XEYO's deterministic V2 reducer from the source events represented by the selected Harness span, then renders the V2 canonical state. It remains a different projection from V1, as it is in XEYO.
- Neither path calls an LLM while compressing. DSH records WSC as an unmarked deterministic summary and still owns the transaction and checkpoint lifecycle.

## Requirements

- DeepSeek Harness `0.1.1-rc.2` (the version installed on the target machine this adapter was built against)
- Node.js 20 or newer
- Python 3.11 or newer; on Windows the adapter first tries `py -3.11`
- A session workspace (`session.header.cwd`) for V1's `Read` cold-store references

The Python core uses only the standard library. No model key or network access is needed for WSC projection.

## Install in an existing profile

Install the plugin in the profile that owns the DSH host packages:

```powershell
dsh plugin --profile web add github:<owner>/<repository>
```

Copy this repository's `preset` directory to `%USERPROFILE%\.dsh\.agent-presets\xeyo-wsc` (or `$DSH_HOME/.agent-presets/xeyo-wsc`). The included preset is based on the shipped `standard` preset for DSH `0.1.1-rc.2`; it keeps that preset's tools and settings and replaces only the compaction backend. Select **XEYO WSC** in the agent preset selector. To make it the default for new sessions, set `agent-presets.default` to `xeyo-wsc` in the existing `$DSH_HOME/settings.yaml`, preserving its other settings.

After the first compaction, the plugin creates `%USERPROFILE%\.dsh\wsc\settings.json` (or `$DSH_HOME/wsc/settings.json`) with:

```json
{
  "implementation": "v1"
}
```

Set `implementation` to `"v2"` to select V2. The setting is re-read for each compaction attempt; the Harness does not need a restart. Any value other than `v1` or `v2`, or any extra key, fails the attempt with a configuration error.

V1 state is stored as compressed JSON in `$DSH_HOME/wsc/state/`; the append-only DSH session log remains the source of truth if that cache is absent or invalid. WSC cold-view files are retained in the workspace because summaries may contain links to earlier views.

## Development

```powershell
node --test
py -3.11 -m unittest discover -s python/tests -p 'test_*.py' -v
```

The code under `python/synaptic/` and `python/memory/wsc2/` is vendored from XEYO commit `bbbe465043ae3dbff9086ab017c691bd4c8e7b63`; the adapter contains only DSH protocol and persistence glue. Keep those core files byte-for-byte aligned with XEYO when updating the source revision.

## Licenses

The WSC source and adapter use XEYO's MIT license. The included preset composition is based on DeepSeek Harness `0.1.1-rc.2` and its MIT-licensed `standard` preset; see [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
