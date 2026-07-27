cmake_minimum_required(VERSION 3.22)
project(VirgoAudioMasters VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ── Fetch JUCE via CMake FetchContent ─────────────────────────────────────────
# Requires an internet connection on first configure; subsequent builds use cache.
include(FetchContent)
FetchContent_Declare(
    JUCE
    GIT_REPOSITORY  https://github.com/juce-framework/JUCE.git
    GIT_TAG         7.0.12          # change to latest stable as needed
    GIT_SHALLOW     TRUE
)
FetchContent_MakeAvailable(JUCE)

# ── Global compile definitions shared by every target ─────────────────────────
add_compile_definitions(
    JUCE_WEB_BROWSER=0
    JUCE_USE_CURL=0
    JUCE_VST3_CAN_REPLACE_VST2=0
    JUCE_DISPLAY_SPLASH_SCREEN=0
    JUCE_REPORT_APP_USAGE=0
)

# ── Shared LookAndFeel + generic editor library ────────────────────────────────
add_subdirectory(shared)

# ── Mastering plugins ─────────────────────────────────────────────────────────
add_subdirectory(mastering/utility)
add_subdirectory(mastering/dynamic-eq)
add_subdirectory(mastering/compressor)
add_subdirectory(mastering/exciter)
add_subdirectory(mastering/imager)
add_subdirectory(mastering/maximizer)
add_subdirectory(mastering/low-end-focus)
add_subdirectory(mastering/clarity)
add_subdirectory(mastering/vintage-tape)

# ── Restoration plugins ───────────────────────────────────────────────────────
add_subdirectory(restoration/de-clip)
add_subdirectory(restoration/de-click)
add_subdirectory(restoration/de-crackle)
add_subdirectory(restoration/de-hum)
add_subdirectory(restoration/de-noise)
add_subdirectory(restoration/de-plosive)
