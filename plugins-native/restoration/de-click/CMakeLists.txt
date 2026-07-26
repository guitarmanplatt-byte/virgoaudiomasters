juce_add_plugin(VADeClick
    COMPANY_NAME                "VirgoAudioMasters"
    COMPANY_WEBSITE             "https://virgoaudiomasters.com"
    PLUGIN_MANUFACTURER_CODE    Vram
    PLUGIN_CODE                 VaDk
    FORMATS                     VST3 AU Standalone
    PRODUCT_NAME                "VA De-click"
    IS_SYNTH                    FALSE
    NEEDS_MIDI_INPUT            FALSE
    NEEDS_MIDI_OUTPUT           FALSE
    IS_MIDI_EFFECT              FALSE
    EDITOR_WANTS_KEYBOARD_FOCUS FALSE
    VST3_CATEGORIES             "Fx" "Restoration"
    AU_MAIN_TYPE                kAudioUnitType_Effect
    COPY_PLUGIN_AFTER_BUILD     FALSE
)
target_sources(VADeClick PRIVATE PluginProcessor.cpp)
target_compile_definitions(VADeClick PUBLIC JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0 JUCE_VST3_CAN_REPLACE_VST2=0)
target_link_libraries(VADeClick
    PRIVATE VirgoShared juce::juce_audio_utils juce::juce_dsp
    PUBLIC  juce::juce_recommended_config_flags juce::juce_recommended_lto_flags juce::juce_recommended_warning_flags)
juce_generate_juce_header(VADeClick)
