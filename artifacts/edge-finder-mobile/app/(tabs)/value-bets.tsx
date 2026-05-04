import { useGetAiPicks, useRefreshAiPicks } from "@workspace/api-client-react";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BookmakerSheet } from "@/components/BookmakerSheet";
import { QuickAddModal, type QuickAddBet } from "@/components/QuickAddModal";
import { useColors } from "@/hooks/useColors";
import type { AIPick, AIParlay, AIPickLeg } from "@workspace/api-client-react";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtOdds(o: number) {
  return o > 0 ? `+${o}` : `${o}`;
}

function confidenceColor(c: number, colors: ReturnType<typeof useColors>) {
  if (c >= 70) return "#22c55e";
  if (c >= 58) return "#f59e0b";
  return "#ef4444";
}

function combinedOddsPayoutStr(odds: number): string {
  const decimal = odds > 0 ? odds / 100 + 1 : 100 / Math.abs(odds) + 1;
  const payout = ((decimal - 1) * 100).toFixed(0);
  return `$${payout} profit per $100`;
}

function sportBadgeColor(sport: string): string {
  switch (sport) {
    case "NBA": return "#F97316";
    case "MLB": return "#3B82F6";
    case "NHL": return "#8B5CF6";
    case "NFL": return "#22C55E";
    default: return "#6B7280";
  }
}

function formatMatchup(pick: AIPick | AIPickLeg) {
  return `${pick.awayTeam} @ ${pick.homeTeam}`;
}

function formatTime(iso: string) {
  const d = new Date(iso);
  const h = d.getHours() % 12 || 12;
  const m = d.getMinutes().toString().padStart(2, "0");
  const ampm = d.getHours() >= 12 ? "PM" : "AM";
  return `${h}:${m} ${ampm}`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function AIPickCard({
  pick,
  onTrack,
  onBet,
}: {
  pick: AIPick;
  onTrack: () => void;
  onBet: () => void;
}) {
  const colors = useColors();
  const [expanded, setExpanded] = useState(false);
  const confColor = confidenceColor(pick.confidence, colors);
  const edgePositive = pick.edge > 0;

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={() => {
        Haptics.selectionAsync();
        setExpanded((e) => !e);
      }}
      activeOpacity={0.85}
    >
      {/* Header row */}
      <View style={styles.cardHeader}>
        <View style={[styles.sportBadge, { backgroundColor: sportBadgeColor(pick.sport) }]}>
          <Text style={styles.sportBadgeText}>{pick.sport}</Text>
        </View>
        <Text style={[styles.matchup, { color: colors.foreground }]} numberOfLines={1}>
          {pick.awayTeam} @ {pick.homeTeam}
        </Text>
        <Text style={[styles.gameTime, { color: colors.mutedForeground }]}>
          {formatTime(pick.startTime)}
        </Text>
      </View>

      {/* Pick row */}
      <View style={styles.pickRow}>
        <View style={styles.pickLeft}>
          <View style={[styles.aiBadge, { backgroundColor: colors.primary + "22", borderColor: colors.primary + "44" }]}>
            <Feather name="cpu" size={11} color={colors.primary} />
            <Text style={[styles.aiBadgeText, { color: colors.primary }]}>AI Pick</Text>
          </View>
          <Text style={[styles.pickText, { color: colors.foreground }]}>{pick.pick}</Text>
          <Text style={[styles.bookmakerText, { color: colors.mutedForeground }]}>
            via {pick.bookmaker}
          </Text>
        </View>
        <View style={styles.pickRight}>
          <Text style={[styles.oddsText, { color: edgePositive ? "#22c55e" : colors.foreground }]}>
            {fmtOdds(pick.odds)}
          </Text>
          <Text style={[styles.edgeText, { color: colors.mutedForeground }]}>
            {pick.edge.toFixed(1)}% edge
          </Text>
        </View>
      </View>

      {/* Confidence bar */}
      <View style={styles.confRow}>
        <View style={[styles.confBar, { backgroundColor: colors.border }]}>
          <View
            style={[
              styles.confFill,
              { backgroundColor: confColor, width: `${pick.confidence}%` as any },
            ]}
          />
        </View>
        <Text style={[styles.confLabel, { color: confColor }]}>
          {pick.confidence}% confidence
        </Text>
      </View>

      {/* Reasoning (expanded) */}
      {expanded && (
        <View style={[styles.reasoning, { borderTopColor: colors.border }]}>
          <View style={styles.reasoningHeader}>
            <Feather name="activity" size={13} color={colors.mutedForeground} />
            <Text style={[styles.reasoningLabel, { color: colors.mutedForeground }]}>AI Analysis</Text>
          </View>
          <Text style={[styles.reasoningText, { color: colors.foreground }]}>
            {pick.reasoning}
          </Text>
          {pick.tags?.length > 0 && (
            <View style={styles.tagsRow}>
              {pick.tags.map((tag) => (
                <View key={tag} style={[styles.tag, { backgroundColor: colors.border }]}>
                  <Text style={[styles.tagText, { color: colors.mutedForeground }]}>
                    {tag.replace(/_/g, " ")}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      {/* Action buttons */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.actionBtn, styles.trackBtn, { borderColor: colors.border }]}
          onPress={(e) => { e.stopPropagation?.(); onTrack(); }}
        >
          <Feather name="plus" size={14} color={colors.foreground} />
          <Text style={[styles.actionBtnText, { color: colors.foreground }]}>Track</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, styles.betBtn, { backgroundColor: colors.primary }]}
          onPress={(e) => { e.stopPropagation?.(); onBet(); }}
        >
          <Feather name="external-link" size={14} color="#fff" />
          <Text style={[styles.betBtnText]}>Place Bet</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

function ParlayCard({
  parlay,
  onBet,
}: {
  parlay: AIParlay;
  onBet: (leg: AIPickLeg) => void;
}) {
  const colors = useColors();
  const [expanded, setExpanded] = useState(false);
  const confColor = confidenceColor(parlay.confidence, colors);

  return (
    <TouchableOpacity
      style={[styles.card, styles.parlayCard, { backgroundColor: colors.card, borderColor: colors.primary + "55" }]}
      onPress={() => {
        Haptics.selectionAsync();
        setExpanded((e) => !e);
      }}
      activeOpacity={0.85}
    >
      {/* Header */}
      <View style={styles.parlayHeader}>
        <View style={[styles.parlayBadge, { backgroundColor: colors.primary }]}>
          <Text style={styles.parlayBadgeText}>🔗 {parlay.legs.length}-Leg Parlay</Text>
        </View>
        <Text style={[styles.parlayOdds, { color: "#22c55e" }]}>{fmtOdds(parlay.combinedOdds)}</Text>
      </View>

      <Text style={[styles.parlayName, { color: colors.foreground }]}>{parlay.name}</Text>
      <Text style={[styles.parlayPayout, { color: colors.mutedForeground }]}>
        {combinedOddsPayoutStr(parlay.combinedOdds)}
      </Text>

      {/* Legs */}
      <View style={[styles.legList, { borderTopColor: colors.border }]}>
        {parlay.legs.map((leg, i) => (
          <View key={i} style={[styles.legRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
            <View style={[styles.legDot, { backgroundColor: sportBadgeColor(leg.sport) }]} />
            <View style={styles.legInfo}>
              <Text style={[styles.legMatchup, { color: colors.mutedForeground }]} numberOfLines={1}>
                {formatMatchup(leg)}
              </Text>
              <Text style={[styles.legPick, { color: colors.foreground }]}>{leg.pick}</Text>
            </View>
            <Text style={[styles.legOdds, { color: colors.primary }]}>{fmtOdds(leg.odds)}</Text>
          </View>
        ))}
      </View>

      {/* Confidence */}
      <View style={styles.confRow}>
        <View style={[styles.confBar, { backgroundColor: colors.border }]}>
          <View style={[styles.confFill, { backgroundColor: confColor, width: `${parlay.confidence}%` as any }]} />
        </View>
        <Text style={[styles.confLabel, { color: confColor }]}>{parlay.confidence}% confidence</Text>
      </View>

      {/* Reasoning expanded */}
      {expanded && (
        <View style={[styles.reasoning, { borderTopColor: colors.border }]}>
          <View style={styles.reasoningHeader}>
            <Feather name="activity" size={13} color={colors.mutedForeground} />
            <Text style={[styles.reasoningLabel, { color: colors.mutedForeground }]}>Why this parlay?</Text>
          </View>
          <Text style={[styles.reasoningText, { color: colors.foreground }]}>{parlay.reasoning}</Text>
        </View>
      )}

      {/* Bet button */}
      <TouchableOpacity
        style={[styles.actionBtn, styles.betBtnFull, { backgroundColor: colors.primary }]}
        onPress={(e) => {
          e.stopPropagation?.();
          onBet(parlay.legs[0]);
        }}
      >
        <Feather name="external-link" size={14} color="#fff" />
        <Text style={styles.betBtnText}>Place Parlay Bet</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

function SkeletonCard() {
  const colors = useColors();
  return (
    <View style={[styles.card, styles.skeleton, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.skelLine, styles.skelShort, { backgroundColor: colors.border }]} />
      <View style={[styles.skelLine, styles.skelFull, { backgroundColor: colors.border }]} />
      <View style={[styles.skelLine, styles.skelMid, { backgroundColor: colors.border }]} />
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function AiPicksScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const [activeTab, setActiveTab] = useState<"picks" | "parlays">("picks");
  const [quickAdd, setQuickAdd] = useState<QuickAddBet | null>(null);
  const [bookmakerBet, setBookmakerBet] = useState<{
    matchup: string;
    pick: string;
    odds: number;
    preferredBookmaker?: string;
  } | null>(null);

  const { data, isLoading, isFetching, refetch } = useGetAiPicks({
    query: { staleTime: 5 * 60_000, refetchOnWindowFocus: false },
  });
  const { mutate: doRefresh, isPending: isRefreshing } = useRefreshAiPicks();

  const picks = data?.picks ?? [];
  const parlays = data?.parlays ?? [];

  function openTrack(pick: AIPick) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setQuickAdd({
      matchup: formatMatchup(pick),
      pick: pick.pick,
      bookmaker: pick.bookmaker,
      odds: pick.odds,
    });
  }

  function openBet(pick: { awayTeam: string; homeTeam: string; pick: string; odds: number; bookmaker: string }) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setBookmakerBet({
      matchup: `${pick.awayTeam} @ ${pick.homeTeam}`,
      pick: pick.pick,
      odds: pick.odds,
      preferredBookmaker: pick.bookmaker,
    });
  }

  function handleRefresh() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    doRefresh(undefined, { onSettled: () => refetch() });
  }

  const isAI = data?.isAI ?? false;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }, isWeb && styles.webRoot]}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + 100 },
          isWeb && styles.webScroll,
        ]}
        refreshControl={
          <RefreshControl
            refreshing={isFetching && !isLoading}
            onRefresh={refetch}
            tintColor={colors.primary}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Summary banner */}
        {data?.summary ? (
          <View style={[styles.summaryBanner, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.summaryLeft}>
              <View style={[styles.aiBadge, { backgroundColor: isAI ? colors.primary + "22" : colors.border, borderColor: isAI ? colors.primary + "44" : colors.border }]}>
                <Feather name="cpu" size={11} color={isAI ? colors.primary : colors.mutedForeground} />
                <Text style={[styles.aiBadgeText, { color: isAI ? colors.primary : colors.mutedForeground }]}>
                  {isAI ? "AI Generated" : "Model Picks"}
                </Text>
              </View>
              <Text style={[styles.summaryText, { color: colors.mutedForeground }]} numberOfLines={3}>
                {data.summary}
              </Text>
            </View>
            <TouchableOpacity onPress={handleRefresh} disabled={isRefreshing} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
              <Feather
                name="refresh-cw"
                size={18}
                color={colors.primary}
                style={isRefreshing ? { opacity: 0.4 } : undefined}
              />
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Tab selector */}
        <View style={[styles.tabSelector, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TouchableOpacity
            style={[styles.tabBtn, activeTab === "picks" && { backgroundColor: colors.primary }]}
            onPress={() => setActiveTab("picks")}
          >
            <Text style={[styles.tabBtnText, { color: activeTab === "picks" ? "#fff" : colors.mutedForeground }]}>
              Single Picks ({picks.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabBtn, activeTab === "parlays" && { backgroundColor: colors.primary }]}
            onPress={() => setActiveTab("parlays")}
          >
            <Text style={[styles.tabBtnText, { color: activeTab === "parlays" ? "#fff" : colors.mutedForeground }]}>
              Parlays ({parlays.length})
            </Text>
          </TouchableOpacity>
        </View>

        {/* Content */}
        {isLoading ? (
          <View style={styles.cards}>
            {[0, 1, 2, 3].map((i) => <SkeletonCard key={i} />)}
          </View>
        ) : activeTab === "picks" ? (
          picks.length === 0 ? (
            <View style={styles.empty}>
              <Feather name="cpu" size={40} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No picks yet</Text>
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Pull down to refresh or tap the refresh icon above.</Text>
            </View>
          ) : (
            <View style={styles.cards}>
              {picks.map((pick) => (
                <AIPickCard
                  key={pick.id}
                  pick={pick}
                  onTrack={() => openTrack(pick)}
                  onBet={() => openBet(pick)}
                />
              ))}
            </View>
          )
        ) : (
          parlays.length === 0 ? (
            <View style={styles.empty}>
              <Feather name="link" size={40} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No parlays yet</Text>
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Parlays will appear once picks are generated.</Text>
            </View>
          ) : (
            <View style={styles.cards}>
              {parlays.map((parlay) => (
                <ParlayCard
                  key={parlay.id}
                  parlay={parlay}
                  onBet={(leg) => openBet({ ...leg, pick: `${parlay.name} (parlay)`, odds: parlay.combinedOdds })}
                />
              ))}
            </View>
          )
        )}
      </ScrollView>

      <QuickAddModal
        visible={!!quickAdd}
        bet={quickAdd}
        onClose={() => setQuickAdd(null)}
      />

      <BookmakerSheet
        visible={!!bookmakerBet}
        bet={bookmakerBet}
        onClose={() => setBookmakerBet(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  webRoot: { maxWidth: 800, alignSelf: "center", width: "100%" },
  scroll: { padding: 16, gap: 12 },
  webScroll: { paddingTop: 24 },
  summaryBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
    marginBottom: 4,
  },
  summaryLeft: { flex: 1, gap: 6 },
  summaryText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  tabSelector: {
    flexDirection: "row",
    padding: 4,
    borderRadius: 10,
    borderWidth: 1,
    gap: 4,
    marginBottom: 4,
  },
  tabBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center" },
  tabBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  cards: { gap: 12 },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  parlayCard: { borderWidth: 1.5 },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sportBadge: {
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  sportBadgeText: {
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    color: "#fff",
  },
  matchup: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  gameTime: { fontSize: 12, fontFamily: "Inter_400Regular" },
  pickRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  pickLeft: { flex: 1, gap: 4 },
  pickRight: { alignItems: "flex-end", gap: 2 },
  aiBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  aiBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  pickText: { fontSize: 18, fontFamily: "Inter_700Bold" },
  bookmakerText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  oddsText: { fontSize: 22, fontFamily: "Inter_700Bold" },
  edgeText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  confRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  confBar: { flex: 1, height: 5, borderRadius: 3, overflow: "hidden" },
  confFill: { height: "100%", borderRadius: 3 },
  confLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", minWidth: 100, textAlign: "right" },
  reasoning: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
    gap: 8,
  },
  reasoningHeader: { flexDirection: "row", alignItems: "center", gap: 5 },
  reasoningLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  reasoningText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
  tagsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tag: { borderRadius: 5, paddingHorizontal: 7, paddingVertical: 3 },
  tagText: { fontSize: 10, fontFamily: "Inter_400Regular" },
  actions: { flexDirection: "row", gap: 8 },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 9,
    gap: 5,
  },
  trackBtn: { borderWidth: 1 },
  actionBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  betBtn: {},
  betBtnFull: { flex: 1 },
  betBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" },
  parlayHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  parlayBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  parlayBadgeText: { fontSize: 12, fontFamily: "Inter_700Bold", color: "#fff" },
  parlayOdds: { fontSize: 24, fontFamily: "Inter_700Bold" },
  parlayName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  parlayPayout: { fontSize: 12, fontFamily: "Inter_400Regular" },
  legList: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, gap: 0 },
  legRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, gap: 10 },
  legDot: { width: 8, height: 8, borderRadius: 4 },
  legInfo: { flex: 1, gap: 2 },
  legMatchup: { fontSize: 11, fontFamily: "Inter_400Regular" },
  legPick: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  legOdds: { fontSize: 14, fontFamily: "Inter_700Bold" },
  skeleton: { height: 130 },
  skelLine: { height: 12, borderRadius: 6, opacity: 0.4 },
  skelShort: { width: "35%" },
  skelFull: { width: "90%", marginTop: 8 },
  skelMid: { width: "60%", marginTop: 8 },
  empty: { alignItems: "center", paddingTop: 60, gap: 12 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", maxWidth: 260, lineHeight: 20 },
});
