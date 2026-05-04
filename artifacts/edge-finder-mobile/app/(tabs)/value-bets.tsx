import { useGetValueBets } from "@workspace/api-client-react";
import React, { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { BetCard } from "@/components/BetCard";
import { EmptyState } from "@/components/EmptyState";
import { FilterChips } from "@/components/FilterChips";
import { useColors } from "@/hooks/useColors";

const SPORTS = [
  { label: "All", value: "all" },
  { label: "NFL", value: "NFL" },
  { label: "NBA", value: "NBA" },
  { label: "MLB", value: "MLB" },
  { label: "NHL", value: "NHL" },
];

const EDGES = [
  { label: "1%+", value: "1" },
  { label: "3%+", value: "3" },
  { label: "5%+", value: "5" },
  { label: "7%+", value: "7" },
];

export default function ValueBetsScreen() {
  const colors = useColors();
  const isWeb = Platform.OS === "web";
  const [sport, setSport] = useState("all");
  const [minEdge, setMinEdge] = useState("1");

  const { data, isLoading, isFetching, refetch } = useGetValueBets(
    { sport: sport as "all" | "NFL" | "NBA" | "MLB" | "NHL", minEdge: Number(minEdge) }
  );

  const bets = data ?? [];

  return (
    <View style={[styles.root, { backgroundColor: colors.background }, isWeb && styles.webRoot]}>
      <View style={[styles.filters, { borderBottomColor: colors.border }]}>
        <FilterChips options={SPORTS} selected={sport} onSelect={setSport} />
        <FilterChips options={EDGES} selected={minEdge} onSelect={setMinEdge} />
      </View>

      {isLoading ? (
        <View style={styles.loader}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : !bets.length ? (
        <EmptyState
          icon="trending-up"
          title="No value bets found"
          subtitle={`No edges above ${minEdge}% right now. Try lowering the threshold or check back soon.`}
        />
      ) : (
        <FlatList
          data={bets}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <BetCard
              homeTeam={item.homeTeam}
              awayTeam={item.awayTeam}
              sport={item.sport}
              team={item.team}
              betType={item.betType}
              bookmaker={item.bookmaker}
              odds={item.odds}
              edge={item.edge}
              kellyStake={item.kellyStake}
              status={item.status}
            />
          )}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={isFetching} onRefresh={refetch} tintColor={colors.primary} />
          }
          ListHeaderComponent={
            <Text style={[styles.count, { color: colors.mutedForeground }]}>
              {bets.length} bets · sorted by edge
            </Text>
          }
          scrollEnabled={!!bets.length}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  webRoot: { paddingTop: 67 },
  filters: { borderBottomWidth: StyleSheet.hairlineWidth },
  loader: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { paddingTop: 8, paddingBottom: 100 },
  count: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
});
