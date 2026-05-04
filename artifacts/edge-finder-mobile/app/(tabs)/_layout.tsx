import { BlurView } from "expo-blur";
import { Feather } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import React from "react";
import { Platform, StyleSheet, View, useColorScheme } from "react-native";

import { useColors } from "@/hooks/useColors";

type FeatherIconName = React.ComponentProps<typeof Feather>["name"];

function TabIcon({ name, color, focused }: { name: FeatherIconName; color: string; focused: boolean }) {
  return (
    <View style={[tabStyles.iconWrap, focused && tabStyles.iconWrapActive]}>
      <Feather name={name} size={20} color={color} />
    </View>
  );
}

const tabStyles = StyleSheet.create({
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  iconWrapActive: {
    backgroundColor: "rgba(167,139,250,0.15)",
  },
});

export default function TabLayout() {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        headerShown: true,
        headerStyle: {
          backgroundColor: colors.background,
        },
        headerTintColor: colors.foreground,
        headerTitleStyle: {
          fontFamily: "Inter_700Bold",
          fontSize: 18,
          letterSpacing: -0.3,
        },
        headerShadowVisible: false,
        headerTitleAlign: "left",
        tabBarStyle: {
          position: "absolute",
          backgroundColor: isIOS ? "transparent" : colors.card,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.border,
          elevation: 0,
          height: isWeb ? 84 : 60,
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={85}
              tint={isDark ? "dark" : "light"}
              style={StyleSheet.absoluteFill}
            />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.card, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]} />
          ),
        tabBarLabelStyle: {
          fontFamily: "Inter_500Medium",
          fontSize: 10,
          marginBottom: isWeb ? 8 : 2,
        },
        tabBarIconStyle: {
          marginTop: 4,
        },
      }}
    >
      <Tabs.Screen
        name="value-bets"
        options={{
          title: "Picks",
          headerTitle: "Today's Picks",
          tabBarIcon: ({ color, focused }) => <TabIcon name="zap" color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="index"
        options={{
          title: "Dashboard",
          headerTitle: "Dashboard",
          tabBarIcon: ({ color, focused }) => <TabIcon name="home" color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="props"
        options={{
          title: "Props",
          headerTitle: "Player Props",
          tabBarIcon: ({ color, focused }) => <TabIcon name="target" color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="arb"
        options={{
          title: "Arb",
          headerTitle: "Arb Scanner",
          tabBarIcon: ({ color, focused }) => <TabIcon name="shuffle" color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="tracker"
        options={{
          title: "Tracker",
          headerTitle: "Bet Tracker",
          tabBarIcon: ({ color, focused }) => <TabIcon name="trending-up" color={color} focused={focused} />,
        }}
      />
    </Tabs>
  );
}
