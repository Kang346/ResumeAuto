# Software Engineer, Distributed Systems

**Company:** Demo (fictional — used only by `python pipeline/run_pipeline.py --demo`)
**Location:** Remote (US) or San Francisco, CA
**Level:** Entry-level (0–3 years)

## About the team

We run a multi-region, strongly-consistent key-value store that powers ~50K
QPS of read traffic for our internal product surfaces. The team owns the
storage layer end-to-end: replication, partitioning, on-disk format,
client SDKs, and the observability stack that watches all of it. We care a
lot about correctness under partial failure and about keeping p99 read
latency in single-digit milliseconds across regions.

## What you'll do

- Extend the replication layer (Raft-based) to support new consistency
  modes and faster leader handoff during planned restarts.
- Build and harden gRPC client/server paths — connection pooling, retry
  budgets, and request hedging — to drive p99 latency down further.
- Improve observability: structured logs, RED metrics, and tracing
  through the request path so on-call can debug a slow region in minutes
  instead of hours.
- Write chaos tests that prove the cluster keeps its consistency
  guarantees under network partitions and rolling restarts.

## What we're looking for

- BS or MS in Computer Science (or equivalent practical experience).
- 0–3 years of professional software experience.
- Strong systems fundamentals: memory model, concurrency, networking,
  Linux process model.
- Comfortable in **C++** or **Go** — we use both. Python is fine for
  tooling.
- Exposure to distributed-systems primitives: consensus (Raft / Paxos),
  replicated logs, consistent hashing, gossip.
- Bonus: experience with low-latency / lock-free data structures,
  custom allocators, or kernel-bypass networking.

This is a sample posting bundled with ResumeAuto. The pre-baked tailoring
in `examples/sample_tailored.json` is keyed to this JD.
