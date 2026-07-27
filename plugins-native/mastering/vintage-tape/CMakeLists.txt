juce_add_plugin(VAVintageTape
    COMPANY_NAME                "VirgoAudioMasters"
    COMPANY_WEBSITE             "https://virgoaudiomasters.com"
    PLUGIN_MANUFACTURER_CODE    Vram
    PLUGIN_CODE                 VaVT
    FORMATS                     VST3 AU Standalone
    PRODUCT_NAME                "VA Vintage Tape"
    IS_SYNTH                    FALSE
    NEEDS_MIDI_INPUT            FALSE
    NEEDS_MIDI_OUTPUT           FALSE
    IS_MIDI_EFFECT              FALSE
    EDITOR_WANTS_KEYBOARD_FOCUS FALSE
    VST3_CATEGORIES             "Fx" "Distortion" "Mastering"
    AU_MAIN_TYPE                kAudioUnitType_Effect
    COPY_PLUGIN_AFTER_BUILD     FALSE
)
target_sources(VAVintageTape PRIVATE PluginProcessor.cpp)
target_compile_definitions(VAVintageTape PUBLIC JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0 JUCE_VST3_CAN_REPLACE_VST2=0)
target_link_libraries(VAVintageTape
    PRIVATE VirgoShared juce::juce_audio_utils juce::juce_dsp
    PUBLIC  juce::juce_recommended_config_flags juce::juce_recommended_lto_flags juce::juce_recommended_warning_flags)
juce_generate_juce_header(VAVintageTape)
