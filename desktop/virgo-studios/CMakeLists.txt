cmake_minimum_required(VERSION 3.22)
project(VirgoStudios VERSION 0.2.0 LANGUAGES C CXX)
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
    VERSION 0.2.0)
target_sources(VirgoStudios PRIVATE
    src/Main.cpp src/AudioEngine.cpp src/MainComponent.cpp src/Session.cpp src/Assistant.cpp
    src/PluginChain.cpp src/TrackTools.cpp)
target_compile_definitions(VirgoStudios PRIVATE
    JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0
    JUCE_PLUGINHOST_VST3=1
    JUCE_APPLICATION_NAME_STRING="Virgo Studios"
    JUCE_APPLICATION_VERSION_STRING="0.2.0")
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
endif()

if(BUILD_TESTING)
    add_executable(VirgoStudiosDSPTests tests/DSPTests.cpp)
    add_test(NAME VirgoStudiosDSPTests COMMAND VirgoStudiosDSPTests)
    add_executable(VirgoStudiosQuantizeTests tests/QuantizeTests.cpp)
    add_test(NAME VirgoStudiosQuantizeTests COMMAND VirgoStudiosQuantizeTests)
endif()

if(WIN32 AND DEFINED ENV{GITHUB_ACTIONS})
    set(verificationArgs "")
    if(NOT CMAKE_SOURCE_DIR STREQUAL CMAKE_CURRENT_SOURCE_DIR)
        list(APPEND verificationArgs "-DPLUGIN_BINARY=$<TARGET_FILE:VASilverOpto_VST3>")
    endif()
    if(BUILD_TESTING)
        add_dependencies(VirgoStudios VirgoStudiosDSPTests VirgoStudiosQuantizeTests)
        list(APPEND verificationArgs
            "-DDSP_TEST=$<TARGET_FILE:VirgoStudiosDSPTests>"
            "-DQUANTIZE_TEST=$<TARGET_FILE:VirgoStudiosQuantizeTests>")
    endif()
    add_custom_command(TARGET VirgoStudios POST_BUILD
        COMMAND ${CMAKE_COMMAND}
            "-DAPP=$<TARGET_FILE:VirgoStudios>"
            "-DPREVIEW=${CMAKE_CURRENT_BINARY_DIR}/native-preview.png"
            ${verificationArgs}
            -P "${CMAKE_CURRENT_SOURCE_DIR}/ci/VerifyNative.cmake")
endif()
