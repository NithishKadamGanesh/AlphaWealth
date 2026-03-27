# Technical Signal Engine Scaffold

This C++ workspace is the future home for low-latency/native feature extraction and model scoring.

The current Java + Python path is the production-ready integration for this repo:
- Java `analysis-svc` orchestrates analysis APIs
- Python `model-svc` generates model-driven suggestions

This C++ scaffold gives us a clean place to port hot paths later without changing higher-level APIs.
