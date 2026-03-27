FROM gcc:14 AS native-builder
WORKDIR /native
COPY cpp-native/technical-signal-engine /native
RUN g++ -std=c++20 -O3 -Iinclude src/feature_engine.cpp src/cli.cpp -o signal_engine_cli

FROM python:3.11-slim
WORKDIR /app
COPY python-research /app
COPY --from=native-builder /native/signal_engine_cli /usr/local/bin/signal_engine_cli
RUN pip install --no-cache-dir -e .
ENV ALPHATRADE_NATIVE_SIGNAL_BIN=/usr/local/bin/signal_engine_cli
EXPOSE 8090
CMD ["python", "-m", "alphatrade_research.model_service"]
