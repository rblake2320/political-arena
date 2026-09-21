# Completed local inference comparison — 2026-09-21

## Result

Real local inference ran on the RTX 5090 with Qwen2.5 7B Q4_K_M, llama.cpp build 11065 (`ce8caa6e6`), Vulkan, greedy sampling, 4096 context tokens, two slots and a 256-output-token cap. No paid service calls, application model integration, driver replacement, merge or deployment occurred.

| Repaired experiment | Baseline median | Treatment median | Median paired reduction |
| --- | ---: | ---: | ---: |
| Four-task group, speculation off vs ngram-simple | 4.610 s | 1.754 s | 61.84% |
| Same four tasks, serial vs two concurrent requests | 4.733 s | 3.724 s | 21.31% |

All **48/48 scored outputs** passed the frozen strict task checks. All **16/16 paired speculative outputs** were exactly equal to their baseline output. Four counterbalanced speculation pairs and two counterbalanced concurrency pairs ran. These are repeated executions of four cases, not 48 independent test cases. Every case was warmed before timing each group. Model loading/startup/warmup is excluded from these group times and is retained in logs/receipts. Concurrency compares client scheduling against the same continuous-batching server, not a controlled continuous-batching-on/off experiment.

The predeclared speculation graduation criterion (all tasks correct, no loss of accuracy, median paired wall reduction at least 10%) passed for this synthetic text workload.

## Where the benefit came from

| Task | Normal median | Speculative median |
| --- | ---: | ---: |
| Copy source evidence verbatim | 3.436 s | 0.613 s |
| Structured evidence receipt | 0.926 s | 0.905 s |
| Sample/live label | 0.112 s | 0.101 s |
| Preserve unknown initiating action | 0.107 s | 0.115 s |

Source copying supplies predictable tokens already present in the prompt; n-gram drafting benefits strongly. The short unknown-action decision was slightly slower. Decision: retain speculation as a candidate for source-preserving long outputs, not an unconditional default for short judgments. Do not multiply the speculation and concurrency improvements; the combined configuration was not compared.

This is not an image/OCR benchmark or an NVIDIA TensorRT implementation result. The user-supplied articles motivated the experiment; their H200 speedup was not imported into our results. AIPerf was not used. We measured request/group wall time and server-reported prompt/decode timings, not streaming TTFT, GPU-seconds, electricity, or production latency percentiles. EPD disaggregation requires a separate multimodal serving experiment and was not selected for this single-host text comparison.

## Failure found and repaired

The original run produced Markdown-fenced JSON instead of a JSON-only receipt in both arms: **36/48 passed**, so its graduation verdict is **FAIL** despite lower runtime. Original outputs, runner, config, timings and failure remain in `proofs/inference-20260921/`.

Root cause: prompt-only formatting was being treated as a machine interface; no decoder grammar constrained that output. The repaired run adds the same JSON schema to both arms. It restricts keys/types, not correct values; the model must still infer sample/action/result from the supplied state. Wrong-value JSON is explicitly rejected by the scorer. Warmup was also corrected from one short case to every case; comparisons do not mix original and repaired runs.

Five regression checks pass: correct answers, wrong answers, fenced JSON rejection, valid-but-false JSON rejection, and hash/extra-file tamper detection. The original result could not pass merely because formatting looked plausible. This repair is in the experiment adapter, not an assertion that Arena or Jev had this defect.

## Reproduce / recover

1. Read `RESUME-CHECKPOINT.md`; keep Arena's private state and services intact.
2. Prepare the pinned, digest-verified isolated runtime:
   `powershell -NoProfile -File scripts/prepare-inference-benchmark.ps1`
3. Select the existing licensed local Qwen2.5 7B GGUF identified by `frozen-config.json`; its SHA-256 is retained. Do not publish the model or private state.
4. Run with a NEW output directory (existing output is refused):

```powershell
python scripts/benchmark-local-inference.py --server .wrangler/inference-b11065/llama-server.exe --model D:/ai/ollama/models/blobs/sha256-2bada8a7450677000f678be90653b85d364de7db25eb5ea54136ada5f3933730 --output docs/proofs/inference-new-run --constrain-json
python scripts/test-inference-scorer.py
python scripts/summarize-inference.py docs/proofs/inference-new-run
python scripts/summarize-inference.py docs/proofs/inference-new-run --verify
```

Receipts are written before group execution and after each serial request. An interrupted `running` receipt is unknown, not a pass. A failed concurrent group may not retain every partial response; server logs remain. After an abrupt interpreter/system interruption, reconcile any surviving benchmark server by exact executable path and port before launching another; never terminate unrelated servers. Normal completion stopped every owned server, confirmed by receipts and a fresh process query.

The repaired immutable execution is in `proofs/inference-20260921-constrained/`; `summary.json` is derived from `receipt.json`, and `inventory.json` binds each retained file. `.gitattributes` disables newline conversion for proof bytes. Existing Arena regression receipts remain separate (157 tests and real browser workflows). Arena health was rechecked after the inference runs: database ok, sample_data true.

## Sources

- https://developer.nvidia.com/blog/an-introduction-to-speculative-decoding-for-reducing-latency-in-ai-inference/
- https://developer.nvidia.com/blog/tensorrt-llm-speculative-decoding-boosts-inference-throughput-by-up-to-3-6x/
- https://github.com/ggml-org/llama.cpp/blob/master/docs/speculative.md
- https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md
- https://github.com/ggml-org/llama.cpp/releases/tag/b11065

Completion disposition: local comparison and restart-safe research handoff completed. Keep the measured successful and failed outcomes; do not silently enable a new production backend based on this four-case experiment.
