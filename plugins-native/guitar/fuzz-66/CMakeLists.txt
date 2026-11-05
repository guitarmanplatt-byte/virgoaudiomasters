juce_add_plugin(VAFuzz66
    COMPANY_NAME "VirgoAudioMasters"
    PLUGIN_MANUFACTURER_CODE Vram
    PLUGIN_CODE VaF6
    FORMATS VST3 AU Standalone
    PRODUCT_NAME "VA Fuzz 66"
    IS_SYNTH FALSE
    NEEDS_MIDI_INPUT FALSE
    NEEDS_MIDI_OUTPUT FALSE
    IS_MIDI_EFFECT FALSE
    EDITOR_WANTS_KEYBOARD_FOCUS FALSE
    VST3_CATEGORIES "Fx" "Distortion"
    AU_MAIN_TYPE kAudioUnitType_Effect
    COPY_PLUGIN_AFTER_BUILD FALSE)
target_sources(VAFuzz66 PRIVATE PluginProcessor.cpp PluginEditor.cpp)
target_link_libraries(VAFuzz66 PRIVATE juce::juce_audio_utils juce::juce_dsp
    PUBLIC juce::juce_recommended_config_flags juce::juce_recommended_warning_flags)
juce_generate_juce_header(VAFuzz66)

if(BUILD_TESTING)
    add_executable(VAFuzz66CircuitTests CircuitTests.cpp)
    add_test(NAME VAFuzz66CircuitTests COMMAND VAFuzz66CircuitTests)
    juce_add_console_app(VAFuzz66Tests PRODUCT_NAME "VA Fuzz 66 Tests")
    target_sources(VAFuzz66Tests PRIVATE PluginProcessor.cpp PluginEditor.cpp FuzzTests.cpp)
    target_compile_definitions(VAFuzz66Tests PRIVATE JUCE_PLUGINHOST_VST3=1)
    target_link_libraries(VAFuzz66Tests PRIVATE juce::juce_audio_utils juce::juce_dsp
        PUBLIC juce::juce_recommended_config_flags juce::juce_recommended_warning_flags)
    add_test(NAME VAFuzz66SignalTests COMMAND VAFuzz66Tests)
    if(WIN32 AND DEFINED ENV{GITHUB_ACTIONS})
        add_dependencies(VAFuzz66Tests VAFuzz66_VST3 VAFuzz66CircuitTests)
        add_custom_command(TARGET VAFuzz66Tests POST_BUILD
            COMMAND ${CMAKE_COMMAND}
                "-DTEST_APP=$<TARGET_FILE:VAFuzz66Tests>"
                "-DCIRCUIT_TEST=$<TARGET_FILE:VAFuzz66CircuitTests>"
                "-DPLUGIN_BINARY=$<TARGET_FILE:VAFuzz66_VST3>"
                "-DPREVIEW=${CMAKE_CURRENT_BINARY_DIR}/fuzz-66-preview.png"
                -P "${CMAKE_CURRENT_SOURCE_DIR}/Verify.cmake")
    endif()
endif()
