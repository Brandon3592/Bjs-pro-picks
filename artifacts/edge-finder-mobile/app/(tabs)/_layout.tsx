import { BlurView } from "expo-blur";
import { Feather } from "@expo/vector-icons";
import { Tabs, usePathname, useRouter } from "expo-router";
import React from "react";
import {
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { useColors } from "@/hooks/useColors";

type FeatherIconName = React.ComponentProps<typeof Feather>["name"];

// ─── Tab definitions ──────────────────────────────────────────────────────────

const TAB_DEFS = [
  {
    name: "value-bets",
    href: "/(tabs)/value-bets",
    title: "Today's",
    headerTitle: "Today's Picks",
    icon: "zap" as FeatherIconName,
    match: "/value-bets",
  },
  {
    name: "index",
    href: "/(tabs)/",
    title: "Dashboard",
    headerTitle: "Dashboard",
    icon: "home" as FeatherIconName,
    match: "/",
  },
  {
    name: "props",
    href: "/(tabs)/props",
    title: "Props",
    headerTitle: "Player Props",
    icon: "target" as FeatherIconName,
    match: "/props",
  },
  {
    name: "arb",
    href: "/(tabs)/arb",
    title: "Arb",
    headerTitle: "Arb Scanner",
    icon: "shuffle" as FeatherIconName,
    match: "/arb",
  },
  {
    name: "help",
    href: "/(tabs)/help",
    title: "Help",
    headerTitle: "Help & Support",
    icon: "help-circle" as FeatherIconName,
    match: "/help",
  },
];

// ─── Web Sidebar Layout ───────────────────────────────────────────────────────

function WebSidebar() {
  const colors = useColors();
  const pathname = usePathname();
  const router = useRouter();

  return (
    <View style={[webStyles.sidebar, { backgroundColor: colors.card, borderRightColor: colors.border }]}>
      {/* Branding */}
      <View style={webStyles.brand}>
        <View style={[webStyles.brandIcon, { backgroundColor: colors.primary + "20" }]}>
          <Feather name="zap" size={18} color={colors.primary} />
        </View>
        <View>
          <Text style={[webStyles.brandName, { color: colors.foreground }]}>BJ's Pro Picks</Text>
          <Text style={[webStyles.brandSub, { color: colors.mutedForeground }]}>Sports Betting Edge</Text>
        </View>
      </View>

      <View style={[webStyles.divider, { backgroundColor: colors.border }]} />

      {/* Nav items */}
      <View style={webStyles.navList}>
        {TAB_DEFS.map((tab) => {
          const isActive =
            tab.name === "index"
              ? pathname === "/" || pathname === ""
              : pathname.endsWith(tab.match);

          return (
            <TouchableOpacity
              key={tab.name}
              style={[
                webStyles.navItem,
                isActive && { backgroundColor: colors.primary + "18" },
              ]}
              onPress={() => router.push(tab.href as any)}
              activeOpacity={0.75}
            >
              <View style={[webStyles.navIconWrap, isActive && { backgroundColor: colors.primary + "25" }]}>
                <Feather
                  name={tab.icon}
                  size={16}
                  color={isActive ? colors.primary : colors.mutedForeground}
                />
              </View>
              <Text
                style={[
                  webStyles.navLabel,
                  { color: isActive ? colors.primary : colors.mutedForeground },
                  isActive && webStyles.navLabelActive,
                ]}
              >
                {tab.title}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Footer */}
      <View style={webStyles.sidebarFooter}>
        <View style={[webStyles.divider, { backgroundColor: colors.border, marginBottom: 12 }]} />
        <Text style={[webStyles.footerText, { color: colors.mutedForeground }]}>
          Live odds powered by The Odds API
        </Text>
      </View>
    </View>
  );
}

// ─── Web layout wrapper ───────────────────────────────────────────────────────

function WebLayout() {
  const colors = useColors();
  const pathname = usePathname();
  const activeTab = TAB_DEFS.find((t) =>
    t.name === "index"
      ? pathname === "/" || pathname === ""
      : pathname.endsWith(t.match)
  );

  return (
    <View style={[webStyles.root, { backgroundColor: colors.background }]}>
      <WebSidebar />
      <View style={webStyles.contentCol}>
        {/* Per-page header */}
        <View style={[webStyles.topBar, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
          <Text style={[webStyles.topBarTitle, { color: colors.foreground }]}>
            {activeTab?.headerTitle ?? "BJ's Pro Picks"}
          </Text>
        </View>
        {/* Screen content via tabs (headers hidden on web) */}
        <Tabs
          screenOptions={{
            headerShown: false,
            tabBarStyle: { display: "none" },
          }}
        >
          {TAB_DEFS.map(({ name, title }) => (
            <Tabs.Screen key={name} name={name} options={{ title }} />
          ))}
        </Tabs>
      </View>
    </View>
  );
}

// ─── Mobile tab icon ──────────────────────────────────────────────────────────

function TabIcon({ name, color, focused }: { name: FeatherIconName; color: string; focused: boolean }) {
  return (
    <View style={[mobileStyles.iconWrap, focused && mobileStyles.iconWrapActive]}>
      <Feather name={name} size={20} color={color} />
    </View>
  );
}

// ─── Root layout ─────────────────────────────────────────────────────────────

export default function TabLayout() {
  const colors = useColors();
  const isIOS = Platform.OS === "ios";

  if (Platform.OS === "web") {
    return <WebLayout />;
  }

  return (
    <Tabs
      initialRouteName="value-bets"
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        headerShown: true,
        headerStyle: { backgroundColor: colors.background },
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
          height: 60,
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView intensity={85} tint="dark" style={StyleSheet.absoluteFill} />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.card }]} />
          ),
        tabBarLabelStyle: {
          fontFamily: "Inter_500Medium",
          fontSize: 10,
          marginBottom: 2,
        },
        tabBarIconStyle: { marginTop: 2 },
      }}
    >
      {TAB_DEFS.map(({ name, title, headerTitle, icon }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title,
            headerTitle,
            tabBarIcon: ({ color, focused }) => (
              <TabIcon name={icon} color={color} focused={focused} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}

// ─── Web styles ───────────────────────────────────────────────────────────────

const webStyles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: "row",
  },
  sidebar: {
    width: 220,
    borderRightWidth: 1,
    flexDirection: "column",
    paddingTop: 28,
  },
  brand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  brandIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  brandName: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.4,
  },
  brandSub: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginTop: 1,
  },
  divider: {
    height: 1,
    marginHorizontal: 16,
    marginBottom: 12,
  },
  navList: {
    flex: 1,
    paddingHorizontal: 8,
    gap: 2,
  },
  navItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 10,
  },
  navIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  navLabel: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
  navLabelActive: {
    fontFamily: "Inter_600SemiBold",
  },
  sidebarFooter: {
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  footerText: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    lineHeight: 15,
  },
  contentCol: {
    flex: 1,
    flexDirection: "column",
  },
  topBar: {
    height: 56,
    borderBottomWidth: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  topBarTitle: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.3,
  },
});

// ─── Mobile styles ────────────────────────────────────────────────────────────

const mobileStyles = StyleSheet.create({
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
