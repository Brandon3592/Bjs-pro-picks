import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

interface EdgeBadgeProps {
  edge: number;
  size?: "sm" | "md";
}

export function EdgeBadge({ edge, size = "md" }: EdgeBadgeProps) {
  const colors = useColors();
  const isHot = edge >= 5;
  const isGood = edge >= 3;
  const bg = isHot
    ? colors.positive + "26"
    : isGood
      ? colors.warning + "26"
      : colors.muted;
  const fg = isHot ? colors.positive : isGood ? colors.warning : colors.mutedForeground;

  return (
    <View style={[styles.badge, { backgroundColor: bg }, size === "sm" && styles.badgeSm]}>
      <Text style={[styles.text, { color: fg }, size === "sm" && styles.textSm]}>
        {edge >= 0 ? "+" : ""}{edge.toFixed(1)}%
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 20,
    alignSelf: "flex-start",
  },
  badgeSm: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  text: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
  },
  textSm: {
    fontSize: 11,
  },
});
