# Arena / NVIDIA research restart checkpoint

Updated 2026-09-21 UTC. Read this before resuming. This is a handoff, not a release approval.

## Latest completed follow-through

The inference comparison has now run, not merely been planned. See `INFERENCE-COMPARISON-RESULTS.md`: original 36/48 contract pass (retained failure); schema-constrained follow-up 48/48 pass; speculative median paired group reduction 61.84%; serial-to-two-concurrent reduction 21.31%. Runtime is isolated llama.cpp/Vulkan, not TensorRT or Jev. All owned benchmark servers stopped. The numbered plan below records the earlier staging plan; its text-inference experiment is now completed by these receipts, while multimodal/disaggregated deployments are separate opportunities, not implicitly authorized product changes.

## Active work and preservation

- Repo: `D:\projects\political-arena-beast-ui`; branch `codex/arena-coverage-assurance-20260920`; draft PR #30. Implementation checkpoint: `902444b` (sample labels), preceding `e0e0db6` (restored media and UI wiring).
- Canonical repo: `D:\projects\political-arena`. Do not reset or clean either worktree.
- Preview: http://localhost:8797. Persisted private D1/R2 state: `.wrangler/restored-20260920/v3`. This is a copied local dataset, NOT a public release or off-machine backup.
- Original missing-video cause: preview used a fresh worktree database rather than the original populated state. Keep the explicit persistence path; do not initialize replacement empty state.
- Restart only if 8797 is down: `powershell -NoProfile -File scripts/start-local-review.ps1 -StatePath .wrangler/restored-20260920`.
- Do not stop/restart unrelated services on 5000 or 8787; owner handles A2. Do not manipulate terminals.
- Secrets stay in ignored private files. Never upload `.env`, `.wrangler`, source media, credentials, or workbook contents.
- Previous playback/upload evidence: `docs/LOCAL-UI-RESTORATION.md`, `docs/local-ui-restoration-result.json`. New test receipts live in `docs/proofs/restart-check/`.

## Fresh observations

2026-09-21: Arena health HTTP 200, database ok, sample_data true. MemoryWeb health ok; UltraRAG health/search reachable, but UltraRAG's internal MemoryWeb connection reports 401; search returned no relevant context. Do not treat recalled performance numbers as measurements.

GPU query: RTX 5090, 32607 MiB total, 18225 MiB in use, 5% utilization at that instant. Ollama responds, lists local models, and `/api/ps` reported no loaded models. `aiperf` and `trtllm-serve` were not found on PATH. This is command discovery, not an exhaustive installation audit. Existing GPU allocations must not be evicted for a benchmark.

## What to test next, in order

1. Run `python scripts/run-restart-check.py`. It retains command output, SHA-256, exit codes and an intent receipt before each check. A receipt left `running` after a crash means interrupted/unknown, never pass. Re-run into a new directory; preserve the old one.
2. Existing browser regression checks restored playback, directory navigation, evidence/question access, invalid-race retry, actual login/file upload/draft persistence, and public pages. It creates synthetic local accounts/drafts; do not replay it against production. It assumes the retained 479-race fixture and four race-3 videos.
3. For model optimization, first establish an isolated compatible serving environment and model license/hardware support. Do not send an undocumented speculation flag to Ollama and label it a treatment. Hosted Jev internals cannot be changed through Arena's client.
4. Freeze representative public/synthetic inputs and expected task outcomes: short typed decisions, long evidence reports, and image-heavy visual analysis. Keep hidden evaluation labels out of model inputs.
5. Compare the SAME target model, precision, context, input set and concurrency with speculation disabled/enabled; separately compare sequential/continuous batching and encoding cache/disaggregation. Record model/runtime versions, input hashes, warmup, cold/warm runs, paired order, timeouts, errors, TTFT, output latency, p50/p95, tokens/sec, accepted draft tokens, peak VRAM and actual cost. Never multiply headline speedups.
6. Graduate only if end-to-end task latency/cost improves without task-quality regression. Token verification is not factual or visual-evidence verification. No change to Watch's perception/transition/procedure gates.

## Source map and hypotheses (not local benchmark results)

- [AIPerf](https://developer.nvidia.com/blog/benchmarking-llm-inference-at-scale-with-aiperf/): load generation and inference metrics; measure before optimizing.
- [Encode/prefill/decode separation](https://developer.nvidia.com/blog/when-to-use-encode-prefill-decode-disaggregation-to-accelerate-multimodal-model-serving/): candidate for image-heavy serving; transfer costs may erase gains.
- [In-flight batching](https://developer.nvidia.com/blog/nvidia-tensorrt-llm-now-accelerates-encoder-decoder-models-with-in-flight-batching/): throughput under multiple requests; not necessarily single-request latency.
- [Speculative decoding benchmark](https://developer.nvidia.com/blog/tensorrt-llm-speculative-decoding-boosts-inference-throughput-by-up-to-3-6x/): headline 3.61x used a 405B target/3B drafter on four H200s, not this workstation.
- [Speculation introduction](https://developer.nvidia.com/blog/an-introduction-to-speculative-decoding-for-reducing-latency-in-ai-inference/): lightweight drafting plus target verification; EAGLE requires trained compatible heads. Text-token decoding is not FFmpeg video decoding.
- [Original speculative decoding paper](https://arxiv.org/abs/2211.17192): exact sampling preserves the target distribution, not a general guarantee of identical sampled strings or true statements.

## Authority and durable handoff

## Retained execution: 2026-09-21

`proofs/restart-check/010d4476871c48239c2bb4628ae6cb31/receipt.json` records all five commands passing against implementation `902444bbdc0b2a3d4b96ac8607d0133fbd8b47f6`: 144 Worker tests plus 13 client tests, typecheck, build, audit (zero vulnerabilities), and actual local browser workflow (four video players, file upload to draft, navigation and six public routes). This is existing application verification, not an NVIDIA optimization comparison. Raw logs use `-text` attributes to preserve receipt hashes across checkout platforms.

Environment discovery output is retained separately in `proofs/restart-check/environment.txt`. No model inference, paid API, installation, merge or deployment ran in this checkpoint pass.

User authorized relevant tests and saving information for recovery. No merge, production rollout, public media upload, driver replacement, or interference with other workloads. NVIDIA skill catalog was checked during article review; no strong dedicated speculation skill was found or installed. Test automation uses existing real-browser/Worker tests rather than model opinions about wiring.

Commit and push only reviewed source, this plan and sanitized receipts on the existing draft branch. Verify remote HEAD. Git backup protects committed work; private local media still needs a separately authorized private backup destination for disk-loss protection.
