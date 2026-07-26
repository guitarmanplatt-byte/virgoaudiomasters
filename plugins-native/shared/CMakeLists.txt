add_library(VirgoShared STATIC
    VirgoLookAndFeel.cpp
    VirgoGenericEditor.cpp
)

target_include_directories(VirgoShared PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})

target_link_libraries(VirgoShared
    PUBLIC
        juce::juce_audio_processors
        juce::juce_audio_utils
        juce::juce_dsp
        juce::juce_gui_basics
        juce::juce_gui_extra
)

target_compile_definitions(VirgoShared
    PUBLIC
        JUCE_WEB_BROWSER=0
        JUCE_USE_CURL=0
)

# Let JUCE generate a module-aggregate header for VirgoShared itself.
# Plugin targets include their own JuceHeader.h; shared code uses module headers directly.
