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

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: isTrue ? colors.positive + "60" : colors.border }]}>
      {isTrue && (
        <View style={[styles.arbBanner, { backgroundColor: colors.positive }]}>
          <Feather name="check-circle" size={12} color="#fff" />
          <Text style={styles.arbBannerText}>TRUE ARB</Text>
        </View>
      )}
      <View style={styles.cardHeader}>
        <View style={styles.headerLeft}>
          <Text style={[styles.matchup, { color: colors.foreground }]}>
            {item.awayTeam} @ {item.homeTeam}
          </Text>
          <Text style={[styles.sub, { color: colors.mutedForeground }]}>
            {item.sport} · {item.market.toUpperCase()}
          </Text>
        </View>
        <View style={styles.headerRight}>
          <Text style={[styles.profit, { color: isTrue ? colors.positive : colors.warning }]}>
            +{item.profitPct.toFixed(2)}%
          </Text>
          <Text style={[styles.profitDollar, { color: colors.mutedForeground }]}>
            ${profit} on ${stake}
          </Text>
        </View>
      </View>

      <View style={[styles.divider, { backgroundColor: colors.border }]} />

      {item.legs.map((leg, i) => (
        <View key={i} style={[styles.leg, { borderBottomColor: colors.border }]}>
          <View style={styles.legLeft}>
            <Text style={[styles.legOutcome, { color: colors.foreground }]}>{leg.outcome}</Text>
            <Text style={[styles.legBook, { color: colors.mutedForeground }]}>{leg.bookmaker}</Text>
          </View>
          <View style={styles.legRight}>
            <Text style={[styles.legOdds, { color: colors.primary }]}>{formatOdds(leg.odds)}</Text>
            <Text style={[styles.legStake, { color: colors.mutedForeground }]}>
              ${calcStake(leg.stakeRatio, stake)}
            </Text>
          </View>
        </View>
      ))}
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
      {/* Stake input */}
      <View style={[styles.stakeBar, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Feather name="dollar-sign" size={16} color={colors.mutedForeground} />
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
          icon="refresh-cw"
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
              <Text style={[styles.count, { color: colors.mutedForeground }]}>
                {opps.filter((o) => o.isArb).length} true arbs · {opps.length} low-vig
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
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  stakeInput: {
    flex: 1,
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  stakeLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  loader: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { paddingTop: 8, paddingBottom: 100 },
  listHeader: { paddingHorizontal: 16, paddingVertical: 8 },
  count: { fontSize: 12, fontFamily: "Inter_400Regular" },
  card: {
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
  },
  arbBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 5,
  },
  arbBannerText: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    color: "#fff",
    letterSpacing: 0.5,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    padding: 14,
    paddingBottom: 10,
  },
  headerLeft: { flex: 1 },
  headerRight: { alignItems: "flex-end" },
  matchup: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  sub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  profit: { fontSize: 18, fontFamily: "Inter_700Bold" },
  profitDollar: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  divider: { height: 1, marginHorizontal: 14 },
  leg: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  legLeft: { flex: 1 },
  legOutcome: { fontSize: 13, fontFamily: "Inter_500Medium" },
  legBook: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  legRight: { alignItems: "flex-end" },
  legOdds: { fontSize: 14, fontFamily: "Inter_700Bold" },
  legStake: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
});
