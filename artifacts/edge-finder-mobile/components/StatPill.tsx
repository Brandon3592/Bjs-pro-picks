import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

interface StatPillProps {
  label: string;
  value: string | number;
  accent?: boolean;
}

export function StatPill({ label, value, accent }: StatPillProps) {
  const colors = useColors();
  return (
    <View style={[
      styles.pill,
      {
        backgroundColor: accent ? colors.primary + "18" : colors.card,
        borderColor: accent ? colors.primary + "50" : colors.border,
      }
    ]}>
      <Text style={[styles.value, { color: accent ? colors.primary : colors.foreground }]}>
        {value}
      </Text>
      <Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 10,
    alignItems: "center",
    gap: 3,
  },
  value: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
  },
  label: {
    fontSize: 10,
    fontFamily: "Inter_500Medium",
    textAlign: "center",
    letterSpacing: 0.2,
  },
});
