import React from 'react';
import { Platform, StyleSheet, useColorScheme, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { Tabs } from 'expo-router';
import { Icon, Label, NativeTabs } from 'expo-router/unstable-native-tabs';
import { SymbolView } from 'expo-symbols';

function NativeTabLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <Icon sf={{ default: 'waveform', selected: 'waveform' }} />
        <Label>Projects</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="presets">
        <Icon sf={{ default: 'slider.horizontal.3', selected: 'slider.horizontal.3' }} />
        <Label>EQ Presets</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="genres">
        <Icon sf={{ default: 'music.note.list', selected: 'music.note.list' }} />
        <Label>Genres</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function ClassicTabLayout() {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const isDark = true; // app is always dark
  const isIOS = Platform.OS === 'ios';
  const isWeb = Platform.OS === 'web';

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        headerShown: false,
        tabBarStyle: {
          position: 'absolute',
          backgroundColor: isIOS ? 'transparent' : colors.card,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          elevation: 0,
          ...(isWeb ? { height: 84 } : {}),
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={80}
              tint="dark"
              style={StyleSheet.absoluteFill}
            />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.card }]} />
          ),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Projects',
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="waveform" tintColor={color} size={24} />
            ) : (
              <MaterialCommunityIcons name="waveform" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="presets"
        options={{
          title: 'EQ Presets',
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="slider.horizontal.3" tintColor={color} size={24} />
            ) : (
              <Feather name="sliders" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="genres"
        options={{
          title: 'Genres',
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="music.note.list" tintColor={color} size={24} />
            ) : (
              <MaterialCommunityIcons name="playlist-music" size={22} color={color} />
            ),
        }}
      />
    </Tabs>
  );
}

export default function TabLayout() {
  if (isLiquidGlassAvailable()) {
    return <NativeTabLayout />;
  }
  return <ClassicTabLayout />;
}

const styles = StyleSheet.create({});
