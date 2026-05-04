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
      { backgroundColor: accent ? colors.primary + "1a" : colors.card, borderColor: accent ? colors.primary + "40" : colors.border }
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
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: "center",
    gap: 2,
  },
  value: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
  },
  label: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
});
