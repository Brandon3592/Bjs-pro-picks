import { Feather } from "@expo/vector-icons";
import {
  useGetDashboardSummary,
  useGetLineMovements,
  useGetPickHistoryStats,
  type LineMovement,
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

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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

type TopGame = {
  id: string; sport: string; homeTeam: string; awayTeam: string;
  startTime: string; bookCount: number;
  weather?: { temp: number; windSpeed: number; condition: string } | null;
};

function WeatherBadge({ weather }: { weather: NonNullable<TopGame["weather"]> }) {
  const colors = useColors();
  const isWindy = weather.windSpeed >= 15;
  const badgeColor = isWindy ? "#f59e0b" : colors.mutedForeground;
  return (
    <View style={[weatherStyles.badge, { borderColor: badgeColor + "44", backgroundColor: badgeColor + "12" }]}>
      <Feather name={isWindy ? "wind" : "cloud"} size={9} color={badgeColor} />
      <Text style={[weatherStyles.text, { color: badgeColor }]}>
        {Math.round(weather.temp)}°F{isWindy ? ` · ${Math.round(weather.windSpeed)}mph wind` : ""}
      </Text>
    </View>
  );
}

const weatherStyles = StyleSheet.create({
  badge: {
    flexDirection: "row", alignItems: "center", gap: 3,
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 8, borderWidth: 1,
  },
  text: { fontSize: 9, fontFamily: "Inter_500Medium" },
});

function TopGameRow({ game, onTrack }: { game: TopGame; onTrack: () => void }) {
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
          {game.awayTeam} @ {game.homeTeam}
        </Text>
        <Text style={[styles.topBetSub, { color: colors.mutedForeground }]} numberOfLines={1}>
          {game.sport} · {formatTime(game.startTime)} · {game.bookCount} books
        </Text>
        {game.weather && <WeatherBadge weather={game.weather} />}
      </View>
      <View style={styles.topBetRight}>
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
  const pickStatsQ = useGetPickHistoryStats();

  const isRefreshing = summaryQ.isFetching || movementsQ.isFetching;
  const summary = summaryQ.data;
  const movements = movementsQ.data ?? [];
  const topGames: TopGame[] = (summary as any)?.topGames ?? [];
  const ps = pickStatsQ.data;
  const pickRecord = ps && (ps.wins + ps.losses) > 0
    ? `${ps.wins}W-${ps.losses}L`
    : "—";

  const onRefresh = () => {
    summaryQ.refetch();
    movementsQ.refetch();
    pickStatsQ.refetch();
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
        <StatPill label="Live" value={(summary as any)?.liveGamesCount ?? 0} />
        <StatPill label="Upcoming" value={(summary as any)?.upcomingGamesCount ?? 0} />
        <StatPill label="Total" value={(summary as any)?.totalGames ?? 0} accent />
        <StatPill label="Record" value={pickRecord} accent={ps != null && (ps.wins + ps.losses) > 0} />
      </View>

      {/* Today's Top Games */}
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.sectionHeaderRow}>
          <SectionTitle icon="calendar" label="Today's Top Games" />
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
        ) : !topGames.length ? (
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            No upcoming games yet — pull to refresh
          </Text>
        ) : (
          topGames.slice(0, 6).map((g) => (
            <TopGameRow
              key={g.id}
              game={g}
              onTrack={() =>
                setQuickAdd({
                  matchup: `${g.awayTeam} @ ${g.homeTeam}`,
                  pick: `${g.awayTeam} @ ${g.homeTeam}`,
                  bookmaker: "",
                  odds: 0,
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
      {(summaryQ.isLoading || !!((summary as any)?.sportBreakdown?.length)) && (
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
            ((summary as any)?.sportBreakdown ?? []).map((s: any) => (
              <View key={s.sport} style={[styles.sportRow, { borderBottomColor: colors.border }]}>
                <Text style={[styles.sportName, { color: colors.foreground }]}>{s.sport}</Text>
                <View style={styles.sportStats}>
                  <Text style={[styles.sportStat, { color: colors.mutedForeground }]}>
                    {s.games} game{s.games !== 1 ? "s" : ""}
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
  },
  topBetRow: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 12,
    paddingRight: 16,
  },
  topBetAccent: { width: 3, height: 36, borderRadius: 2, marginLeft: 12, marginRight: 10 },
  topBetLeft: { flex: 1, minWidth: 0 },
  topBetMatchup: { fontSize: 13, fontFamily: "Inter_500Medium", letterSpacing: -0.1 },
  topBetSub: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  topBetRight: { alignItems: "flex-end", gap: 4 },
  trackPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
  },
  trackPillText: { fontSize: 10, fontFamily: "Inter_500Medium" },
  moveRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  moveIconWrap: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  moveBody: { flex: 1, minWidth: 0 },
  moveGame: { fontSize: 12, fontFamily: "Inter_500Medium" },
  moveSub: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 1 },
  moveTime: { fontSize: 10, fontFamily: "Inter_400Regular" },
  skeletonWrap: { padding: 12, gap: 10 },
  skeletonRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  skeletonLine: { height: 12, borderRadius: 6 },
  sportRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sportName: { fontSize: 13, fontFamily: "Inter_500Medium" },
  sportStats: { flexDirection: "row", alignItems: "center", gap: 8 },
  sportStat: { fontSize: 12, fontFamily: "Inter_400Regular" },
});
