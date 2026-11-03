cmake_minimum_required(VERSION 3.22)
project(VirgoStudios VERSION 0.1.0 LANGUAGES C CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
include(CTest)
include(FetchContent)
if(NOT TARGET juce::juce_audio_utils)
    FetchContent_Declare(JUCE
        GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
        GIT_TAG 7.0.12
        GIT_SHALLOW TRUE)
    FetchContent_MakeAvailable(JUCE)
endif()

juce_add_gui_app(VirgoStudios
    COMPANY_NAME "VirgoAudioMasters"
    PRODUCT_NAME "Virgo Studios"
    VERSION 0.1.0)
target_sources(VirgoStudios PRIVATE
    src/Main.cpp src/AudioEngine.cpp src/MainComponent.cpp src/Session.cpp src/Assistant.cpp)
target_compile_definitions(VirgoStudios PRIVATE
    JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0
    JUCE_APPLICATION_NAME_STRING="Virgo Studios"
    JUCE_APPLICATION_VERSION_STRING="0.1.0")
target_link_libraries(VirgoStudios PRIVATE
    juce::juce_audio_utils juce::juce_dsp
    juce::juce_recommended_config_flags
    juce::juce_recommended_warning_flags)
juce_generate_juce_header(VirgoStudios)

if(WIN32)
    # The existing native-suite packaging collects *_Standalone.exe.
    add_custom_command(TARGET VirgoStudios POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            "$<TARGET_FILE:VirgoStudios>"
            "$<TARGET_FILE_DIR:VirgoStudios>/Virgo Studios_Standalone.exe")
    if(DEFINED ENV{GITHUB_ACTIONS})
        add_custom_command(TARGET VirgoStudios POST_BUILD
            COMMAND ${CMAKE_COMMAND}
                "-DAPP=$<TARGET_FILE:VirgoStudios>"
                "-DPREVIEW=${CMAKE_CURRENT_BINARY_DIR}/native-preview.png"
                -P "${CMAKE_CURRENT_SOURCE_DIR}/ci/VerifyNative.cmake")
    endif()
endif()

if(BUILD_TESTING)
    add_executable(VirgoStudiosDSPTests tests/DSPTests.cpp)
    add_test(NAME VirgoStudiosDSPTests COMMAND VirgoStudiosDSPTests)
endif()
