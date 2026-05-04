import { Feather } from "@expo/vector-icons";
import {
  useGetDashboardSummary,
  useGetLineMovements,
  type LineMovement,
  type ValueBet,
} from "@workspace/api-client-react";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { QuickAddModal, type QuickAddBet } from "@/components/QuickAddModal";
import { StatPill } from "@/components/StatPill";
import { useColors } from "@/hooks/useColors";

function formatOdds(odds: number) {
  return odds > 0 ? `+${odds}` : `${odds}`;
}

function timeSince(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

function directionIcon(dir: string) {
  if (dir === "steam") return "trending-up";
  if (dir === "reverse") return "trending-down";
  return "minus";
}

function SectionTitle({ icon, label }: { icon: React.ComponentProps<typeof Feather>["name"]; label: string }) {
  const colors = useColors();
  return (
    <View style={secStyles.row}>
      <View style={[secStyles.iconWrap, { backgroundColor: colors.primary + "18" }]}>
        <Feather name={icon} size={14} color={colors.primary} />
      </View>
      <Text style={[secStyles.label, { color: colors.foreground }]}>{label}</Text>
    </View>
  );
}

const secStyles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8, padding: 16, paddingBottom: 10 },
  iconWrap: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  label: { fontSize: 15, fontFamily: "Inter_600SemiBold", letterSpacing: -0.2 },
});

function TopBetRow({ bet, onTrack }: { bet: ValueBet; onTrack: () => void }) {
  const colors = useColors();
  return (
    <TouchableOpacity
      style={[styles.topBetRow, { borderBottomColor: colors.border }]}
      onPress={onTrack}
      activeOpacity={0.75}
    >
      <View style={[styles.topBetAccent, { backgroundColor: colors.primary + "60" }]} />
      <View style={styles.topBetLeft}>
        <Text style={[styles.topBetMatchup, { color: colors.foreground }]} numberOfLines={1}>
          {bet.team} {bet.betType}
        </Text>
        <Text style={[styles.topBetSub, { color: colors.mutedForeground }]} numberOfLines={1}>
          {bet.awayTeam} @ {bet.homeTeam} · {bet.bookmaker}
        </Text>
      </View>
      <View style={styles.topBetRight}>
        <Text style={[styles.topBetOdds, { color: colors.primary }]}>
          {formatOdds(bet.odds)}
        </Text>
        <View style={[styles.trackPill, { borderColor: colors.border }]}>
          <Feather name="plus" size={10} color={colors.mutedForeground} />
          <Text style={[styles.trackPillText, { color: colors.mutedForeground }]}>Track</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

function MovementRow({ m }: { m: LineMovement }) {
  const colors = useColors();
  const moved = m.newPrice - m.oldPrice;
  const isUp = moved > 0;
  const accentColor = isUp ? colors.positive : colors.negative;
  return (
    <View style={[styles.moveRow, { borderBottomColor: colors.border }]}>
      <View style={[styles.moveIconWrap, { backgroundColor: accentColor + "18" }]}>
        <Feather name={directionIcon(m.direction)} size={13} color={accentColor} />
      </View>
      <View style={styles.moveBody}>
        <Text style={[styles.moveGame, { color: colors.foreground }]} numberOfLines={1}>
          {m.awayTeam} @ {m.homeTeam}
        </Text>
        <Text style={[styles.moveSub, { color: colors.mutedForeground }]}>
          {m.bookmaker} · {m.outcomeName} · {m.oldPrice > 0 ? "+" : ""}
          {m.oldPrice} → {m.newPrice > 0 ? "+" : ""}
          {m.newPrice}
        </Text>
      </View>
      <Text style={[styles.moveTime, { color: colors.mutedForeground }]}>
        {timeSince(m.newTime)}
      </Text>
    </View>
  );
}

export default function DashboardScreen() {
  const colors = useColors();
  const isWeb = Platform.OS === "web";
  const [quickAdd, setQuickAdd] = useState<QuickAddBet | null>(null);

  const summaryQ = useGetDashboardSummary();
  const movementsQ = useGetLineMovements({ hours: 6, limit: 30 });

  const isRefreshing = summaryQ.isFetching || movementsQ.isFetching;
  const summary = summaryQ.data;
  const movements = movementsQ.data ?? [];

  const onRefresh = () => {
    summaryQ.refetch();
    movementsQ.refetch();
  };

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: colors.background }]}
      contentContainerStyle={[styles.content, isWeb && styles.webContent]}
      refreshControl={
        <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor={colors.primary} />
      }
      showsVerticalScrollIndicator={false}
    >
      {/* Stats row */}
      <View style={styles.statsRow}>
        <StatPill label="Live Games" value={summary?.liveGamesCount ?? 0} />
        <StatPill label="Upcoming" value={summary?.upcomingGamesCount ?? 0} />
        <StatPill label="Value Bets" value={summary?.totalValueBets ?? 0} accent />
      </View>

      {/* Top Value Bets */}
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.sectionHeaderRow}>
          <SectionTitle icon="zap" label="Top Value Bets" />
          {summaryQ.isLoading && (
            <ActivityIndicator size="small" color={colors.mutedForeground} style={{ marginRight: 16 }} />
          )}
        </View>
        {summaryQ.isLoading ? (
          <View style={styles.skeletonWrap}>
            {[1, 2, 3].map((i) => (
              <View key={i} style={[styles.skeletonRow, { borderBottomColor: colors.border }]}>
                <View style={[styles.skeletonLine, { backgroundColor: colors.muted, width: "60%" }]} />
                <View style={[styles.skeletonLine, { backgroundColor: colors.muted, width: "20%" }]} />
              </View>
            ))}
          </View>
        ) : !summary?.topValueBets?.length ? (
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            No value bets right now — pull to refresh
          </Text>
        ) : (
          summary.topValueBets.slice(0, 6).map((b) => (
            <TopBetRow
              key={b.id}
              bet={b}
              onTrack={() =>
                setQuickAdd({
                  matchup: `${b.awayTeam} @ ${b.homeTeam}`,
                  pick: `${b.team} ${b.betType}`,
                  bookmaker: b.bookmaker,
                  odds: b.odds,
                })
              }
            />
          ))
        )}
      </View>

      {/* Line Movements */}
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.sectionHeaderRow}>
          <SectionTitle icon="activity" label="Line Movements" />
          {movementsQ.isLoading && (
            <ActivityIndicator size="small" color={colors.mutedForeground} style={{ marginRight: 16 }} />
          )}
        </View>
        {movementsQ.isLoading ? (
          <View style={styles.skeletonWrap}>
            {[1, 2, 3, 4].map((i) => (
              <View key={i} style={[styles.skeletonRow, { borderBottomColor: colors.border }]}>
                <View style={[styles.skeletonLine, { backgroundColor: colors.muted, width: "70%" }]} />
                <View style={[styles.skeletonLine, { backgroundColor: colors.muted, width: "25%" }]} />
              </View>
            ))}
          </View>
        ) : !movements.length ? (
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            No recent movements
          </Text>
        ) : (
          movements.map((m, i) => <MovementRow key={`${m.gameId}-${i}`} m={m} />)
        )}
      </View>

      {/* Sport Breakdown */}
      {(summaryQ.isLoading || !!summary?.sportBreakdown?.length) && (
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <SectionTitle icon="bar-chart-2" label="By Sport" />
          {summaryQ.isLoading ? (
            <View style={styles.skeletonWrap}>
              {[1, 2, 3].map((i) => (
                <View key={i} style={[styles.skeletonRow, { borderBottomColor: colors.border }]}>
                  <View style={[styles.skeletonLine, { backgroundColor: colors.muted, width: "30%" }]} />
                  <View style={[styles.skeletonLine, { backgroundColor: colors.muted, width: "50%" }]} />
                </View>
              ))}
            </View>
          ) : (
            summary?.sportBreakdown?.map((s) => (
              <View key={s.sport} style={[styles.sportRow, { borderBottomColor: colors.border }]}>
                <Text style={[styles.sportName, { color: colors.foreground }]}>{s.sport}</Text>
                <View style={styles.sportStats}>
                  <Text style={[styles.sportStat, { color: colors.mutedForeground }]}>
                    {s.games} games
                  </Text>
                  <View style={[styles.sportBadge, { backgroundColor: colors.primary + "18", borderColor: colors.primary + "40" }]}>
                    <Text style={[styles.sportBadgeText, { color: colors.primary }]}>
                      {s.valueBets} value bet{s.valueBets !== 1 ? "s" : ""}
                    </Text>
                  </View>
                </View>
              </View>
            ))
          )}
        </View>
      )}

      <QuickAddModal
        visible={!!quickAdd}
        bet={quickAdd}
        onClose={() => setQuickAdd(null)}
        onAdded={() => setQuickAdd(null)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 16, gap: 12, paddingBottom: 110 },
  webContent: { paddingTop: 24 },
  statsRow: { flexDirection: "row", gap: 10 },
  sectionHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  section: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  emptyText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    padding: 16,
    paddingTop: 4,
    paddingBottom: 16,
  },
  skeletonWrap: { paddingBottom: 6 },
  skeletonRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  skeletonLine: { height: 11, borderRadius: 6 },
  topBetRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingRight: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  topBetAccent: { width: 3, height: 36, borderRadius: 2, marginLeft: 1 },
  topBetLeft: { flex: 1 },
  topBetMatchup: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  topBetSub: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  topBetRight: { alignItems: "flex-end", gap: 4 },
  topBetOdds: { fontSize: 15, fontFamily: "Inter_700Bold" },
  trackPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  trackPillText: { fontSize: 10, fontFamily: "Inter_500Medium" },
  moveRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  moveIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  moveBody: { flex: 1 },
  moveGame: { fontSize: 13, fontFamily: "Inter_500Medium" },
  moveSub: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  moveTime: { fontSize: 11, fontFamily: "Inter_400Regular" },
  sportRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sportName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  sportStats: { flexDirection: "row", gap: 10, alignItems: "center" },
  sportStat: { fontSize: 12, fontFamily: "Inter_400Regular" },
  sportBadge: {
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  sportBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
});
