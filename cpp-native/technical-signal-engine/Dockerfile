# C++ signal engine - REST + ZMQ pub server
# Build: docker build -t cpp-signal-engine .
# Run:   docker run -p 9000:9000 -p 5555:5555 cpp-signal-engine

FROM gcc:13 AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    cmake \
    libzmq3-dev \
    pkg-config \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY . .
RUN mkdir -p build-server && cd build-server && \
    cmake -DBUILD_SERVER=ON -DCMAKE_BUILD_TYPE=Release .. && \
    make -j$(nproc)

FROM ubuntu:24.04
RUN apt-get update && apt-get install -y --no-install-recommends \
    libzmq5 \
    libbrotli1 \
    wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /build/build-server/signal_engine_server /app/signal_engine_server

EXPOSE 9000 5555

HEALTHCHECK --interval=15s --timeout=3s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:9000/health || exit 1

CMD ["/app/signal_engine_server"]
