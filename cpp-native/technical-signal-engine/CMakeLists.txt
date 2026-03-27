cmake_minimum_required(VERSION 3.16)
project(technical_signal_engine LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(technical_signal_engine STATIC
    src/feature_engine.cpp
)

target_include_directories(technical_signal_engine PUBLIC include)

add_executable(signal_engine_demo src/main.cpp)
target_link_libraries(signal_engine_demo PRIVATE technical_signal_engine)

add_executable(signal_engine_cli src/cli.cpp)
target_link_libraries(signal_engine_cli PRIVATE technical_signal_engine)
