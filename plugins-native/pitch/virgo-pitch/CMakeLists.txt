juce_add_plugin(VirgoPitch
    COMPANY_NAME "VirgoAudioMasters"
    PLUGIN_MANUFACTURER_CODE Vram
    PLUGIN_CODE VrPt
    FORMATS VST3 AU Standalone
    PRODUCT_NAME "Virgo Pitch"
    IS_SYNTH FALSE
    NEEDS_MIDI_INPUT FALSE
    NEEDS_MIDI_OUTPUT FALSE
    IS_MIDI_EFFECT FALSE
    EDITOR_WANTS_KEYBOARD_FOCUS FALSE
    VST3_CATEGORIES "Fx" "Pitch Shift"
    AU_MAIN_TYPE kAudioUnitType_Effect
    COPY_PLUGIN_AFTER_BUILD FALSE)
target_sources(VirgoPitch PRIVATE PitchEngine.cpp PluginProcessor.cpp PluginEditor.cpp)
target_link_libraries(VirgoPitch PRIVATE juce::juce_audio_utils
    PUBLIC juce::juce_recommended_config_flags juce::juce_recommended_warning_flags)
juce_generate_juce_header(VirgoPitch)

if(BUILD_TESTING)
    add_executable(VirgoPitchEngineTests PitchEngine.cpp EngineTests.cpp)
    add_test(NAME VirgoPitchEngineTests COMMAND VirgoPitchEngineTests)
    juce_add_console_app(VirgoPitchTests PRODUCT_NAME "Virgo Pitch Tests")
    target_sources(VirgoPitchTests PRIVATE PitchEngine.cpp PluginProcessor.cpp PluginEditor.cpp PluginTests.cpp)
    target_compile_definitions(VirgoPitchTests PRIVATE JUCE_PLUGINHOST_VST3=1)
    target_link_libraries(VirgoPitchTests PRIVATE juce::juce_audio_utils
        PUBLIC juce::juce_recommended_config_flags juce::juce_recommended_warning_flags)
    add_test(NAME VirgoPitchSignalTests COMMAND VirgoPitchTests)
    if(WIN32 AND DEFINED ENV{GITHUB_ACTIONS})
        add_dependencies(VirgoPitchTests VirgoPitch_VST3 VirgoPitchEngineTests)
        add_custom_command(TARGET VirgoPitchTests POST_BUILD
            COMMAND ${CMAKE_COMMAND}
                "-DTEST_APP=$<TARGET_FILE:VirgoPitchTests>"
                "-DENGINE_TEST=$<TARGET_FILE:VirgoPitchEngineTests>"
                "-DPLUGIN_BINARY=$<TARGET_FILE:VirgoPitch_VST3>"
                "-DPREVIEW=${CMAKE_CURRENT_BINARY_DIR}/virgo-pitch-preview.png"
                -P "${CMAKE_CURRENT_SOURCE_DIR}/Verify.cmake")
    endif()
endif()
