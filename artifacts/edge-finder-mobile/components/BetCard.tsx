import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { EdgeBadge } from "./EdgeBadge";
import { useColors } from "@/hooks/useColors";

interface BetCardProps {
  homeTeam: string;
  awayTeam: string;
  sport: string;
  team: string;
  betType: string;
  bookmaker: string;
  odds: number;
  edge: number;
  kellyStake: number;
  status: "live" | "upcoming";
  onPress?: () => void;
}

function formatOdds(odds: number) {
  return odds > 0 ? `+${odds}` : `${odds}`;
}

function formatKelly(k: number) {
  return `${(k * 100).toFixed(1)}% Kelly`;
}

const SPORT_ICONS: Record<string, string> = {
  NFL: "🏈",
  NBA: "🏀",
  MLB: "⚾",
  NHL: "🏒",
};

export function BetCard({
  homeTeam, awayTeam, sport, team, betType, bookmaker, odds, edge, kellyStake, status, onPress,
}: BetCardProps) {
  const colors = useColors();

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress?.();
  };

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={handlePress}
      activeOpacity={0.8}
    >
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={[styles.matchup, { color: colors.foreground }]}>
            {awayTeam} @ {homeTeam}
          </Text>
          <View style={styles.meta}>
            <Text style={[styles.sport, { color: colors.mutedForeground }]}>
              {SPORT_ICONS[sport] ?? ""} {sport}
            </Text>
            {status === "live" && (
              <View style={[styles.liveDot, { backgroundColor: colors.positive }]} />
            )}
          </View>
        </View>
        <EdgeBadge edge={edge} />
      </View>

      <View style={[styles.divider, { backgroundColor: colors.border }]} />

      <View style={styles.body}>
        <View style={styles.row}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Pick</Text>
          <Text style={[styles.value, { color: colors.foreground }]}>
            {team} {betType}
          </Text>
        </View>
        <View style={styles.row}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Odds</Text>
          <Text style={[styles.value, styles.odds, { color: colors.primary }]}>
            {formatOdds(odds)}
          </Text>
        </View>
        <View style={styles.row}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Book</Text>
          <Text style={[styles.value, { color: colors.foreground }]}>{bookmaker}</Text>
        </View>
        <View style={styles.row}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Kelly</Text>
          <Text style={[styles.value, { color: colors.mutedForeground }]}>{formatKelly(kellyStake)}</Text>
        </View>
      </View>

      {/* Track CTA */}
      <View style={[styles.trackRow, { borderTopColor: colors.border, backgroundColor: colors.muted }]}>
        <Feather name="plus-circle" size={14} color={colors.primary} />
        <Text style={[styles.trackText, { color: colors.primary }]}>Track this bet</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    marginHorizontal: 16,
    marginBottom: 10,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    padding: 14,
    paddingBottom: 10,
  },
  headerLeft: { flex: 1, marginRight: 10 },
  matchup: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 3 },
  meta: { flexDirection: "row", alignItems: "center", gap: 6 },
  sport: { fontSize: 12, fontFamily: "Inter_400Regular" },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  divider: { height: 1, marginHorizontal: 14 },
  body: { padding: 14, paddingTop: 10, gap: 6 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  label: { fontSize: 13, fontFamily: "Inter_400Regular", width: 48 },
  value: { fontSize: 13, fontFamily: "Inter_500Medium", flex: 1, textAlign: "right" },
  odds: { fontFamily: "Inter_700Bold", fontSize: 14 },
  trackRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderTopWidth: 1,
  },
  trackText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
