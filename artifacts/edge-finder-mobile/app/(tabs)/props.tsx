import { Feather } from "@expo/vector-icons";
import { useGetProps, useGetPropsGames } from "@workspace/api-client-react";
import React, { useState } from "react";
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

import { EdgeBadge } from "@/components/EdgeBadge";
import { EmptyState } from "@/components/EmptyState";
import { FilterChips } from "@/components/FilterChips";
import { useColors } from "@/hooks/useColors";

const SPORTS = [
  { label: "NBA", value: "NBA" },
  { label: "NFL", value: "NFL" },
  { label: "MLB", value: "MLB" },
  { label: "NHL", value: "NHL" },
];

const NBA_MARKETS = [
  { label: "Points", value: "player_points" },
  { label: "Rebounds", value: "player_rebounds" },
  { label: "Assists", value: "player_assists" },
  { label: "3-Pointers", value: "player_threes" },
  { label: "Blocks", value: "player_blocks" },
  { label: "Steals", value: "player_steals" },
];
const NFL_MARKETS = [
  { label: "Pass Yds", value: "player_pass_yds" },
  { label: "Rush Yds", value: "player_rush_yds" },
  { label: "Rec Yds", value: "player_reception_yds" },
  { label: "TDs", value: "player_anytime_td" },
];
const MLB_MARKETS = [
  { label: "Strikeouts", value: "batter_strikeouts" },
  { label: "Hits", value: "batter_hits" },
  { label: "Total Bases", value: "batter_total_bases" },
  { label: "RBIs", value: "batter_rbis" },
];
const NHL_MARKETS = [
  { label: "Goals", value: "player_goals" },
  { label: "Assists", value: "player_assists" },
  { label: "Points", value: "player_points" },
  { label: "Shots", value: "player_shots_on_goal" },
];

const SPORT_MARKETS: Record<string, typeof NBA_MARKETS> = {
  NBA: NBA_MARKETS,
  NFL: NFL_MARKETS,
  MLB: MLB_MARKETS,
  NHL: NHL_MARKETS,
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
  const [selectedMarket, setSelectedMarket] = useState(markets[0].value);

  const gamesQ = useGetPropsGames({ sport });
  const games = gamesQ.data ?? [];

  const activeGame = selectedGame ?? games[0]?.id ?? null;

  const propsQ = useGetProps(
    { gameId: activeGame ?? "", sport, markets: selectedMarket },
    { query: { enabled: !!activeGame, queryKey: [] } }
  );
  const props = propsQ.data ?? [];

  const handleSportChange = (s: string) => {
    setSport(s as "NBA" | "NFL" | "MLB" | "NHL");
    setSelectedGame(null);
    const mkt = SPORT_MARKETS[s];
    setSelectedMarket(mkt[0].value);
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
      ) : games.length === 0 ? null : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.gameScroll}>
          {games.map((g) => {
            const active = (activeGame === g.id);
            return (
              <TouchableOpacity
                key={g.id}
                style={[
                  styles.gameChip,
                  {
                    backgroundColor: active ? colors.foreground : colors.muted,
                    borderColor: active ? colors.foreground : colors.border,
                  },
                ]}
                onPress={() => setSelectedGame(g.id)}
                activeOpacity={0.8}
              >
                <Text style={[styles.gameChipText, { color: active ? colors.background : colors.foreground }]} numberOfLines={1}>
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
      {!activeGame ? (
        <EmptyState icon="user" title="No games available" subtitle="Check back when games are scheduled." />
      ) : propsQ.isLoading ? (
        <View style={styles.loader}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : !props.length ? (
        <EmptyState icon="user" title="No props found" subtitle="No edge on this market. Try another." />
      ) : (
        <FlatList
          data={props}
          keyExtractor={(item, i) => `${item.player}-${item.market}-${i}`}
          renderItem={({ item }) => (
            <View style={[styles.propCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.propHeader}>
                <View style={styles.propLeft}>
                  <Text style={[styles.propPlayer, { color: colors.foreground }]}>{item.player}</Text>
                  <Text style={[styles.propMarket, { color: colors.mutedForeground }]}>
                    {item.side} {item.line} {item.marketLabel}
                  </Text>
                </View>
                <EdgeBadge edge={item.edge} />
              </View>
              <View style={[styles.propFooter, { borderTopColor: colors.border }]}>
                <Text style={[styles.propBook, { color: colors.mutedForeground }]}>{item.bookmaker}</Text>
                <Text style={[styles.propOdds, { color: colors.primary }]}>{formatOdds(item.odds)}</Text>
                <Text style={[styles.propProb, { color: colors.mutedForeground }]}>
                  {(item.impliedProb * 100).toFixed(0)}% implied
                </Text>
              </View>
            </View>
          )}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={propsQ.isFetching} onRefresh={() => propsQ.refetch()} tintColor={colors.primary} />
          }
          ListHeaderComponent={
            <Text style={[styles.count, { color: colors.mutedForeground }]}>
              {props.length} props · sorted by edge
            </Text>
          }
          scrollEnabled={!!props.length}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  webRoot: { paddingTop: 67 },
  sportTabs: { borderBottomWidth: StyleSheet.hairlineWidth },
  miniLoader: { padding: 12, alignItems: "center" },
  gameScroll: { paddingHorizontal: 16, paddingVertical: 10, gap: 8, flexDirection: "row" },
  gameChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    maxWidth: 180,
  },
  gameChipText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  marketRow: { borderBottomWidth: StyleSheet.hairlineWidth },
  loader: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { paddingTop: 8, paddingBottom: 100 },
  count: { fontSize: 12, fontFamily: "Inter_400Regular", paddingHorizontal: 16, paddingVertical: 8 },
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
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  propBook: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1 },
  propOdds: { fontSize: 14, fontFamily: "Inter_700Bold" },
  propProb: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "right", flex: 1 },
});
