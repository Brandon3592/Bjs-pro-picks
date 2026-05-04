import { Feather } from "@expo/vector-icons";
import { useGetProps, useGetPropsGames } from "@workspace/api-client-react";
import React, { useState, useMemo } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { EmptyState } from "@/components/EmptyState";
import { FilterChips } from "@/components/FilterChips";
import { QuickAddModal, type QuickAddBet } from "@/components/QuickAddModal";
import { useColors } from "@/hooks/useColors";

const SPORTS = [
  { label: "NBA", value: "NBA" },
  { label: "NFL", value: "NFL" },
  { label: "MLB", value: "MLB" },
  { label: "NHL", value: "NHL" },
];

const NBA_MARKETS = [
  { label: "All", value: "all" },
  { label: "Points", value: "player_points" },
  { label: "Rebounds", value: "player_rebounds" },
  { label: "Assists", value: "player_assists" },
  { label: "3-Ptrs", value: "player_threes" },
  { label: "Blocks", value: "player_blocks" },
  { label: "Steals", value: "player_steals" },
];
const NFL_MARKETS = [
  { label: "All", value: "all" },
  { label: "Pass Yds", value: "player_pass_yds" },
  { label: "Rush Yds", value: "player_rush_yds" },
  { label: "Rec Yds", value: "player_reception_yds" },
  { label: "TDs", value: "player_anytime_td" },
];
const MLB_MARKETS = [
  { label: "All", value: "all" },
  { label: "Strikeouts", value: "batter_strikeouts" },
  { label: "Hits", value: "batter_hits" },
  { label: "Total Bases", value: "batter_total_bases" },
  { label: "RBIs", value: "batter_rbis" },
];
const NHL_MARKETS = [
  { label: "All", value: "all" },
  { label: "Goals", value: "player_goals" },
  { label: "Assists", value: "player_assists" },
  { label: "Points", value: "player_points" },
  { label: "Shots", value: "player_shots_on_goal" },
];

const SPORT_MARKETS: Record<string, { label: string; value: string }[]> = {
  NBA: NBA_MARKETS,
  NFL: NFL_MARKETS,
  MLB: MLB_MARKETS,
  NHL: NHL_MARKETS,
};

const ALL_MARKET_KEYS: Record<string, string> = {
  NBA: "player_points,player_rebounds,player_assists,player_threes,player_blocks,player_steals",
  NFL: "player_pass_yds,player_rush_yds,player_reception_yds,player_anytime_td",
  MLB: "batter_strikeouts,batter_hits,batter_total_bases,batter_rbis",
  NHL: "player_goals,player_assists,player_points,player_shots_on_goal",
};

function formatOdds(odds: number) {
  return odds > 0 ? `+${odds}` : `${odds}`;
}

export default function PropsScreen() {
  const colors = useColors();
  const isWeb = Platform.OS === "web";
  const [sport, setSport] = useState<"NBA" | "NFL" | "MLB" | "NHL">("NBA");
  const [selectedGame, setSelectedGame] = useState<string | null>(null);
  const markets = SPORT_MARKETS[sport];
  const [selectedMarket, setSelectedMarket] = useState("all");
  const [quickAdd, setQuickAdd] = useState<QuickAddBet | null>(null);

  const gamesQ = useGetPropsGames({ sport });
  const games = gamesQ.data ?? [];
  const activeGame = selectedGame ?? games[0]?.id ?? null;
  const activeGameData = games.find((g) => g.id === activeGame);

  const propsQ = useGetProps(
    { gameId: activeGame ?? "", sport, markets: ALL_MARKET_KEYS[sport] },
    { query: { enabled: !!activeGame } } as any
  );
  const allProps = propsQ.data ?? [];

  const filteredProps = useMemo(() => {
    if (selectedMarket === "all") return allProps;
    return allProps.filter((p) => p.market === selectedMarket);
  }, [allProps, selectedMarket]);

  const handleSportChange = (s: string) => {
    setSport(s as "NBA" | "NFL" | "MLB" | "NHL");
    setSelectedGame(null);
    setSelectedMarket("all");
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }, isWeb && styles.webRoot]}>
      {/* Sport tabs */}
      <View style={[styles.sportTabs, { borderBottomColor: colors.border }]}>
        <FilterChips options={SPORTS} selected={sport} onSelect={handleSportChange} />
      </View>

      {/* Game selector */}
      {gamesQ.isLoading ? (
        <View style={styles.miniLoader}>
          <ActivityIndicator color={colors.primary} size="small" />
        </View>
      ) : games.length === 0 ? (
        <View style={[styles.noGamesBar, { borderBottomColor: colors.border }]}>
          <Text style={[styles.noGamesText, { color: colors.mutedForeground }]}>
            No {sport} games scheduled today
          </Text>
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.gameScroll}
          style={[styles.gameScrollBg, { borderBottomColor: colors.border }]}
        >
          {games.map((g) => {
            const active = activeGame === g.id;
            return (
              <TouchableOpacity
                key={g.id}
                style={[
                  styles.gameChip,
                  {
                    backgroundColor: active ? colors.primary : colors.muted,
                    borderColor: active ? colors.primary : colors.border,
                  },
                ]}
                onPress={() => setSelectedGame(g.id)}
                activeOpacity={0.75}
              >
                <Text
                  style={[
                    styles.gameChipText,
                    { color: active ? colors.primaryForeground : colors.foreground },
                  ]}
                  numberOfLines={1}
                >
                  {g.awayTeam} @ {g.homeTeam}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {/* Market filter */}
      <View style={[styles.marketRow, { borderBottomColor: colors.border }]}>
        <FilterChips options={markets} selected={selectedMarket} onSelect={setSelectedMarket} />
      </View>

      {/* Props list */}
      {gamesQ.isLoading ? (
        <View style={styles.loader}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>
            Loading games…
          </Text>
        </View>
      ) : !activeGame ? (
        <EmptyState
          icon="user"
          title="No games available"
          subtitle="Check back when games are scheduled."
        />
      ) : propsQ.isLoading ? (
        <View style={styles.loader}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>
            Loading props…
          </Text>
        </View>
      ) : filteredProps.length === 0 ? (
        <EmptyState
          icon="user"
          title="No props found"
          subtitle={
            selectedMarket === "all"
              ? "No props available for this game. Try another game."
              : "No props on this market. Try 'All' or a different stat."
          }
        />
      ) : (
        <FlatList
          data={filteredProps}
          keyExtractor={(item, i) => `${item.player}-${item.market}-${item.line}-${i}`}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.propCard, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() =>
                setQuickAdd({
                  matchup: activeGameData
                    ? `${activeGameData.awayTeam} @ ${activeGameData.homeTeam}`
                    : sport,
                  pick: `${item.player} ${item.side} ${item.line} ${item.marketLabel}`,
                  bookmaker: item.bookmaker,
                  odds: item.odds,
                })
              }
              activeOpacity={0.8}
            >
              <View style={styles.propHeader}>
                <View style={styles.propLeft}>
                  <Text style={[styles.propPlayer, { color: colors.foreground }]}>
                    {item.player}
                  </Text>
                  <Text style={[styles.propMarket, { color: colors.mutedForeground }]}>
                    {item.side} {item.line} {item.marketLabel}
                  </Text>
                </View>
                </View>
              <View style={[styles.propFooter, { borderTopColor: colors.border, backgroundColor: colors.muted }]}>
                <Text style={[styles.propBook, { color: colors.mutedForeground }]}>
                  {item.bookmaker}
                </Text>
                <Text style={[styles.propOdds, { color: colors.primary }]}>
                  {formatOdds(item.odds)}
                </Text>
                <View style={styles.propRight}>
                  <Text style={[styles.propProb, { color: colors.mutedForeground }]}>
                    {item.impliedProb.toFixed(1)}% implied
                  </Text>
                  <View style={styles.trackHint}>
                    <Feather name="plus-circle" size={12} color={colors.primary} />
                    <Text style={[styles.trackHintText, { color: colors.primary }]}>Track</Text>
                  </View>
                </View>
              </View>
            </TouchableOpacity>
          )}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={propsQ.isFetching}
              onRefresh={() => propsQ.refetch()}
              tintColor={colors.primary}
            />
          }
          ListHeaderComponent={
            <Text style={[styles.count, { color: colors.mutedForeground }]}>
              {filteredProps.length} prop{filteredProps.length !== 1 ? "s" : ""} · tap to track
            </Text>
          }
          scrollEnabled
        />
      )}

      <QuickAddModal
        visible={!!quickAdd}
        bet={quickAdd}
        onClose={() => setQuickAdd(null)}
        onAdded={() => setQuickAdd(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  webRoot: { paddingTop: 67 },
  sportTabs: { borderBottomWidth: StyleSheet.hairlineWidth },
  miniLoader: { padding: 12, alignItems: "center" },
  noGamesBar: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  noGamesText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  gameScrollBg: { borderBottomWidth: StyleSheet.hairlineWidth, flexGrow: 0 },
  gameScroll: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
    flexDirection: "row",
  },
  gameChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    maxWidth: 180,
  },
  gameChipText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  marketRow: { borderBottomWidth: StyleSheet.hairlineWidth },
  loader: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  loadingText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  list: { paddingTop: 8, paddingBottom: 100 },
  count: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  propCard: {
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
  },
  propHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    padding: 14,
    paddingBottom: 10,
  },
  propLeft: { flex: 1, marginRight: 10 },
  propPlayer: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  propMarket: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  propFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  propBook: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1 },
  propOdds: { fontSize: 14, fontFamily: "Inter_700Bold" },
  propRight: { flex: 1, alignItems: "flex-end", gap: 2 },
  propProb: { fontSize: 11, fontFamily: "Inter_400Regular" },
  trackHint: { flexDirection: "row", alignItems: "center", gap: 3 },
  trackHintText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
});
