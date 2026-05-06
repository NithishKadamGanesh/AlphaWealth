cmake_minimum_required(VERSION 3.16)
project(technical_signal_engine LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# ─── Build options ─────────────────────────────────────────
option(BUILD_SERVER "Build the network signal server (requires zmq, json)" OFF)

# ─── Core library: indicators + signals (no deps) ──────────
add_library(technical_signal_engine STATIC
    src/feature_engine.cpp
    src/indicators.cpp
)
target_include_directories(technical_signal_engine PUBLIC include)
target_compile_options(technical_signal_engine PRIVATE -O2 -Wall -Wextra)

# ─── Demos and CLI (no deps) ───────────────────────────────
add_executable(signal_engine_demo src/main.cpp)
target_link_libraries(signal_engine_demo PRIVATE technical_signal_engine)

add_executable(signal_engine_cli src/cli.cpp)
target_link_libraries(signal_engine_cli PRIVATE technical_signal_engine)

# ─── Optional: networked server (ZMQ pub + REST) ──────────
if(BUILD_SERVER)
    find_package(PkgConfig REQUIRED)
    pkg_check_modules(ZMQ REQUIRED libzmq)

    # nlohmann/json: header-only, fetched via FetchContent if not installed
    include(FetchContent)
    FetchContent_Declare(
        json
        GIT_REPOSITORY https://github.com/nlohmann/json.git
        GIT_TAG v3.11.3
    )
    FetchContent_MakeAvailable(json)

    # cpp-httplib: header-only HTTP server
    FetchContent_Declare(
        httplib
        GIT_REPOSITORY https://github.com/yhirose/cpp-httplib.git
        GIT_TAG v0.18.1
    )
    FetchContent_MakeAvailable(httplib)

    add_executable(signal_engine_server src/signal_server.cpp)
    target_link_libraries(signal_engine_server PRIVATE
        technical_signal_engine
        ${ZMQ_LIBRARIES}
        nlohmann_json::nlohmann_json
        httplib::httplib
        pthread
    )
    target_include_directories(signal_engine_server PRIVATE ${ZMQ_INCLUDE_DIRS})
endif()
