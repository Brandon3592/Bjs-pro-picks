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

function TopBetRow({ bet, onTrack }: { bet: ValueBet; onTrack: () => void }) {
  const colors = useColors();
  return (
    <TouchableOpacity
      style={[styles.topBetRow, { borderBottomColor: colors.border }]}
      onPress={onTrack}
      activeOpacity={0.75}
    >
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
      </View>
      <Feather name="plus-circle" size={16} color={colors.primary} style={styles.trackIcon} />
    </TouchableOpacity>
  );
}

function MovementRow({ m }: { m: LineMovement }) {
  const colors = useColors();
  const moved = m.newPrice - m.oldPrice;
  const isUp = moved > 0;
  return (
    <View style={[styles.moveRow, { borderBottomColor: colors.border }]}>
      <View
        style={[
          styles.moveIconWrap,
          { backgroundColor: isUp ? colors.positive + "20" : colors.negative + "20" },
        ]}
      >
        <Feather
          name={directionIcon(m.direction)}
          size={14}
          color={isUp ? colors.positive : colors.negative}
        />
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
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={onRefresh}
          tintColor={colors.primary}
        />
      }
    >
      {/* Stats row */}
      <View style={styles.statsRow}>
        <StatPill label="Live Games" value={summary?.liveGamesCount ?? 0} />
        <StatPill label="Upcoming" value={summary?.upcomingGamesCount ?? 0} />
        <StatPill label="Value Bets" value={summary?.totalValueBets ?? 0} accent />
      </View>

      {/* Top Value Bets */}
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.sectionHeader}>
          <Feather name="zap" size={16} color={colors.primary} />
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Top Value Bets</Text>
          {summaryQ.isLoading && (
            <ActivityIndicator size="small" color={colors.mutedForeground} style={styles.inlineLoader} />
          )}
        </View>
        {summaryQ.isLoading ? (
          <View style={styles.skeletonWrap}>
            {[1, 2, 3].map((i) => (
              <View key={i} style={[styles.skeletonRow, { borderBottomColor: colors.border }]}>
                <View style={[styles.skeletonLine, { backgroundColor: colors.muted, width: "60%" }]} />
                <View style={[styles.skeletonLine, { backgroundColor: colors.muted, width: "30%" }]} />
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
        <View style={styles.sectionHeader}>
          <Feather name="activity" size={16} color={colors.primary} />
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Line Movements</Text>
          {movementsQ.isLoading && (
            <ActivityIndicator size="small" color={colors.mutedForeground} style={styles.inlineLoader} />
          )}
        </View>
        {movementsQ.isLoading ? (
          <View style={styles.skeletonWrap}>
            {[1, 2, 3, 4, 5].map((i) => (
              <View key={i} style={[styles.skeletonRow, { borderBottomColor: colors.border }]}>
                <View style={[styles.skeletonLine, { backgroundColor: colors.muted, width: "70%" }]} />
                <View style={[styles.skeletonLine, { backgroundColor: colors.muted, width: "40%" }]} />
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
          <View style={styles.sectionHeader}>
            <Feather name="bar-chart-2" size={16} color={colors.primary} />
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>By Sport</Text>
          </View>
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
                  <Text style={[styles.sportStat, { color: colors.mutedForeground }]}>
                    {s.valueBets} value bet{s.valueBets !== 1 ? "s" : ""}
                  </Text>
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
  content: { padding: 16, gap: 14 },
  webContent: { paddingTop: 83 },
  statsRow: { flexDirection: "row", gap: 8 },
  section: { borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 14,
    paddingBottom: 10,
  },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", flex: 1 },
  inlineLoader: { marginLeft: "auto" },
  emptyText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    padding: 14,
    paddingTop: 0,
    paddingBottom: 14,
  },
  skeletonWrap: { paddingBottom: 4 },
  skeletonRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  skeletonLine: { height: 12, borderRadius: 6 },
  topBetRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  topBetLeft: { flex: 1 },
  topBetMatchup: { fontSize: 13, fontFamily: "Inter_500Medium" },
  topBetSub: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  topBetRight: { alignItems: "flex-end", gap: 3 },
  topBetOdds: { fontSize: 13, fontFamily: "Inter_700Bold" },
  trackIcon: { marginLeft: 4 },
  moveRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  moveIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  moveBody: { flex: 1 },
  moveGame: { fontSize: 13, fontFamily: "Inter_500Medium" },
  moveSub: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  moveTime: { fontSize: 11, fontFamily: "Inter_400Regular" },
  sportRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sportName: { fontSize: 14, fontFamily: "Inter_500Medium" },
  sportStats: { flexDirection: "row", gap: 10, alignItems: "center" },
  sportStat: { fontSize: 12, fontFamily: "Inter_400Regular" },
  sportEdge: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
});
