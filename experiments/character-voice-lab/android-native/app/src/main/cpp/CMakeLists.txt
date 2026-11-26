cmake_minimum_required(VERSION 3.22)
project(kokoro_phonemizer LANGUAGES C CXX)

include(FetchContent)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(BUILD_TESTING OFF CACHE BOOL "" FORCE)
set(USE_MBROLA OFF CACHE BOOL "" FORCE)
set(USE_LIBSONIC OFF CACHE BOOL "" FORCE)
set(USE_LIBPCAUDIO OFF CACHE BOOL "" FORCE)
set(USE_ASYNC OFF CACHE BOOL "" FORCE)
set(USE_SPEECHPLAYER OFF CACHE BOOL "" FORCE)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
FetchContent_Declare(espeak
    GIT_REPOSITORY https://github.com/espeak-ng/espeak-ng.git
    GIT_TAG 4870adfa25b1a32b4361592f1be8a40337c58d6c)
FetchContent_GetProperties(espeak)
if(NOT espeak_POPULATED)
    FetchContent_Populate(espeak)
    # Android only builds the library. Host-compiled dictionaries are APK assets.
    add_subdirectory(${espeak_SOURCE_DIR} ${espeak_BINARY_DIR} EXCLUDE_FROM_ALL)
endif()

add_library(kokoro_g2p SHARED phonemes.cpp)
target_compile_features(kokoro_g2p PRIVATE cxx_std_17)
target_link_libraries(kokoro_g2p PRIVATE espeak-ng)
