import { Feather } from "@expo/vector-icons";
import { useGetArbOpportunities, type ArbOpportunity } from "@workspace/api-client-react";
import React, { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { EmptyState } from "@/components/EmptyState";
import { useColors } from "@/hooks/useColors";

function formatOdds(odds: number) {
  return odds > 0 ? `+${odds}` : `${odds}`;
}

function calcStake(ratio: number, total: number) {
  return (ratio * total).toFixed(2);
}

function ArbCard({ item, stake }: { item: ArbOpportunity; stake: number }) {
  const colors = useColors();
  const isTrue = item.isArb;
  const profit = ((item.profitPct / 100) * stake).toFixed(2);
  const accentColor = isTrue ? colors.positive : colors.warning;

  return (
    <View style={[styles.card, {
      backgroundColor: colors.card,
      borderColor: isTrue ? colors.positive + "50" : colors.border,
    }]}>
      {/* Top accent line */}
      <View style={[styles.cardAccentBar, { backgroundColor: accentColor }]} />

      <View style={styles.cardContent}>
        {/* Header */}
        <View style={styles.cardHeader}>
          <View style={styles.headerLeft}>
            {isTrue && (
              <View style={[styles.arbTag, { backgroundColor: colors.positive + "20", borderColor: colors.positive + "50" }]}>
                <Feather name="check-circle" size={11} color={colors.positive} />
                <Text style={[styles.arbTagText, { color: colors.positive }]}>TRUE ARB</Text>
              </View>
            )}
            <Text style={[styles.matchup, { color: colors.foreground }]}>
              {item.awayTeam} @ {item.homeTeam}
            </Text>
            <Text style={[styles.sub, { color: colors.mutedForeground }]}>
              {item.sport} · {item.market.toUpperCase()}
            </Text>
          </View>
          <View style={styles.headerRight}>
            <Text style={[styles.profitPct, { color: accentColor }]}>
              +{item.profitPct.toFixed(2)}%
            </Text>
            <Text style={[styles.profitDollar, { color: colors.mutedForeground }]}>
              ${profit} profit
            </Text>
          </View>
        </View>

        {/* Divider */}
        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        {/* Legs */}
        {item.legs.map((leg, i) => (
          <View key={i} style={[styles.leg, { borderBottomColor: colors.border }]}>
            <View style={[styles.legBook, { backgroundColor: colors.muted, borderColor: colors.border }]}>
              <Text style={[styles.legBookText, { color: colors.mutedForeground }]} numberOfLines={1}>
                {leg.bookmaker}
              </Text>
            </View>
            <Text style={[styles.legOutcome, { color: colors.foreground }]} numberOfLines={1}>
              {leg.outcome}
            </Text>
            <View style={styles.legRight}>
              <Text style={[styles.legOdds, { color: accentColor }]}>{formatOdds(leg.odds)}</Text>
              <Text style={[styles.legStake, { color: colors.mutedForeground }]}>
                ${calcStake(leg.stakeRatio, stake)}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

export default function ArbScreen() {
  const colors = useColors();
  const isWeb = Platform.OS === "web";
  const [stakeText, setStakeText] = useState("1000");

  const { data, isLoading, isFetching, refetch } = useGetArbOpportunities();
  const opps = data ?? [];
  const stake = parseFloat(stakeText) || 1000;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }, isWeb && styles.webRoot]}>
      {/* Stake bar */}
      <View style={[styles.stakeBar, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <View style={[styles.stakeIconWrap, { backgroundColor: colors.primary + "18" }]}>
          <Feather name="dollar-sign" size={15} color={colors.primary} />
        </View>
        <TextInput
          style={[styles.stakeInput, { color: colors.foreground }]}
          value={stakeText}
          onChangeText={setStakeText}
          keyboardType="numeric"
          placeholder="Stake amount"
          placeholderTextColor={colors.mutedForeground}
        />
        <Text style={[styles.stakeLabel, { color: colors.mutedForeground }]}>total stake</Text>
      </View>

      {isLoading ? (
        <View style={styles.loader}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : !opps.length ? (
        <EmptyState
          icon="shuffle"
          title="No opportunities right now"
          subtitle="The arb scanner checks live odds across all books. Check back soon."
        />
      ) : (
        <FlatList
          data={opps}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <ArbCard item={item} stake={stake} />}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={isFetching} onRefresh={refetch} tintColor={colors.primary} />
          }
          ListHeaderComponent={
            <View style={styles.listHeader}>
              <View style={[styles.countPill, { backgroundColor: colors.positive + "18", borderColor: colors.positive + "40" }]}>
                <Feather name="check-circle" size={11} color={colors.positive} />
                <Text style={[styles.countText, { color: colors.positive }]}>
                  {opps.filter((o) => o.isArb).length} true arbs
                </Text>
              </View>
              <Text style={[styles.countSub, { color: colors.mutedForeground }]}>
                · {opps.length} total opportunities
              </Text>
            </View>
          }
          scrollEnabled={!!opps.length}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  webRoot: { paddingTop: 67 },
  stakeBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  stakeIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  stakeInput: {
    flex: 1,
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  stakeLabel: { fontSize: 12, fontFamily: "Inter_400Regular" },
  loader: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { paddingTop: 10, paddingBottom: 110 },
  listHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 6,
    gap: 6,
    marginBottom: 4,
  },
  countPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  countText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  countSub: { fontSize: 12, fontFamily: "Inter_400Regular" },
  card: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  cardAccentBar: { height: 3, width: "100%" },
  cardContent: { padding: 0 },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    padding: 14,
    paddingBottom: 10,
    gap: 10,
  },
  headerLeft: { flex: 1, gap: 4 },
  headerRight: { alignItems: "flex-end", gap: 2 },
  arbTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    marginBottom: 2,
  },
  arbTagText: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  matchup: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  sub: { fontSize: 12, fontFamily: "Inter_400Regular" },
  profitPct: { fontSize: 20, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  profitDollar: { fontSize: 11, fontFamily: "Inter_400Regular" },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: 14 },
  leg: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  legBook: {
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 3,
    minWidth: 72,
    alignItems: "center",
  },
  legBookText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  legOutcome: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium" },
  legRight: { alignItems: "flex-end", gap: 1 },
  legOdds: { fontSize: 14, fontFamily: "Inter_700Bold" },
  legStake: { fontSize: 11, fontFamily: "Inter_400Regular" },
});
