import { useGetAiPicks, useRefreshAiPicks } from "@workspace/api-client-react";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
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
  FlatList,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BookmakerSheet } from "@/components/BookmakerSheet";
import { QuickAddModal, type QuickAddBet } from "@/components/QuickAddModal";
import { useColors } from "@/hooks/useColors";
import type { AIPick, AIParlay, AIPickLeg, AILadderParlay } from "@workspace/api-client-react";

// ─── Sport tabs ──────────────────────────────────────────────────────────────

const SPORT_TABS = [
  { key: "all", label: "All Sports", icon: "🌐" },
  { key: "NBA",  label: "NBA",       icon: "🏀" },
  { key: "MLB",  label: "MLB",       icon: "⚾" },
  { key: "NHL",  label: "NHL",       icon: "🏒" },
  { key: "NFL",  label: "NFL",       icon: "🏈" },
] as const;

type SportKey = typeof SPORT_TABS[number]["key"];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtOdds(o: number) {
  return o > 0 ? `+${o}` : `${o}`;
}

function combinedOddsPayoutStr(odds: number): string {
  const decimal = odds > 0 ? odds / 100 + 1 : 100 / Math.abs(odds) + 1;
  const payout = ((decimal - 1) * 100).toFixed(0);
  return `$${payout} profit per $100 wagered`;
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

function confidenceColor(c: number) {
  if (c >= 70) return "#22c55e";
  if (c >= 55) return "#f59e0b";
  return "#ef4444";
}

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({ icon, label, sublabel, accent }: {
  icon: string;
  label: string;
  sublabel: string;
  accent: string;
}) {
  return (
    <View style={[sectionStyles.row, { borderLeftColor: accent }]}>
      <Text style={sectionStyles.icon}>{icon}</Text>
      <View style={sectionStyles.text}>
        <Text style={[sectionStyles.label, { color: accent }]}>{label}</Text>
        <Text style={sectionStyles.sub}>{sublabel}</Text>
      </View>
    </View>
  );
}

const sectionStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderLeftWidth: 3,
    paddingLeft: 10,
    marginBottom: 8,
  },
  icon: { fontSize: 22 },
  text: { flex: 1, gap: 1 },
  label: { fontSize: 15, fontFamily: "Inter_700Bold" },
  sub: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9ca3af" },
});

// ─── Lock of the Day card ─────────────────────────────────────────────────────

function LockCard({
  pick,
  onTrack,
  onBet,
}: {
  pick: AIPick;
  onTrack: () => void;
  onBet: () => void;
}) {
  const colors = useColors();
  const [expanded, setExpanded] = useState(true);
  const GOLD = "#f59e0b";
  const confColor = confidenceColor(pick.confidence);
  const isPositive = pick.odds > 0;

  return (
    <TouchableOpacity
      style={[styles.lockCard, { backgroundColor: colors.card, borderColor: GOLD + "55" }]}
      onPress={() => { Haptics.selectionAsync(); setExpanded((e) => !e); }}
      activeOpacity={0.88}
    >
      {/* Gold header strip */}
      <View style={[styles.lockStrip, { backgroundColor: GOLD + "18" }]}>
        <View style={styles.lockStripLeft}>
          <View style={[styles.sportBadge, { backgroundColor: sportBadgeColor(pick.sport) }]}>
            <Text style={styles.sportBadgeText}>{pick.sport}</Text>
          </View>
          <Text style={[styles.lockMatchup, { color: colors.foreground }]} numberOfLines={1}>
            {pick.awayTeam} @ {pick.homeTeam}
          </Text>
        </View>
        <Text style={[styles.gameTime, { color: colors.mutedForeground }]}>{formatTime(pick.startTime)}</Text>
      </View>

      {/* Main pick */}
      <View style={styles.lockBody}>
        <View style={styles.lockPickLeft}>
          {pick.player ? (
            <Text style={[styles.lockPlayer, { color: GOLD }]}>{pick.player}</Text>
          ) : null}
          <Text style={[styles.lockPick, { color: colors.foreground }]}>{pick.pick}</Text>
          <Text style={[styles.bookmakerText, { color: colors.mutedForeground }]}>
            via {pick.bookmaker}
          </Text>
        </View>
        <View style={styles.lockOddsBlock}>
          <Text style={[styles.lockOdds, { color: isPositive ? "#22c55e" : colors.foreground }]}>
            {fmtOdds(pick.odds)}
          </Text>
        </View>
      </View>

      {/* Confidence bar */}
      <View style={styles.confRow}>
        <View style={[styles.confBar, { backgroundColor: colors.border }]}>
          <View style={[styles.confFill, { backgroundColor: confColor, width: `${pick.confidence}%` as any }]} />
        </View>
        <Text style={[styles.confLabel, { color: confColor }]}>{pick.confidence}% confidence</Text>
      </View>

      {/* AI Reasoning */}
      {expanded && (
        <View style={[styles.reasoning, { borderTopColor: colors.border }]}>
          <View style={styles.reasoningHeader}>
            <Feather name="activity" size={13} color={GOLD} />
            <Text style={[styles.reasoningLabel, { color: GOLD }]}>AI Analysis</Text>
          </View>
          <Text style={[styles.reasoningText, { color: colors.foreground }]}>{pick.reasoning}</Text>
          {pick.tags?.length > 0 && (
            <View style={styles.tagsRow}>
              {pick.tags.map((tag) => (
                <View key={tag} style={[styles.tag, { backgroundColor: GOLD + "22" }]}>
                  <Text style={[styles.tagText, { color: GOLD }]}>{tag.replace(/_/g, " ")}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      {/* Actions */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.actionBtn, styles.trackBtn, { borderColor: colors.border }]}
          onPress={(e) => { e.stopPropagation?.(); onTrack(); }}
        >
          <Feather name="plus" size={14} color={colors.foreground} />
          <Text style={[styles.actionBtnText, { color: colors.foreground }]}>Track</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: GOLD }]}
          onPress={(e) => { e.stopPropagation?.(); onBet(); }}
        >
          <Feather name="external-link" size={14} color="#000" />
          <Text style={[styles.actionBtnText, { color: "#000" }]}>Place Bet</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

// ─── Parlay card ──────────────────────────────────────────────────────────────

function ParlayCard({
  parlay,
  accent,
  onBet,
}: {
  parlay: AIParlay;
  accent: string;
  onBet: (leg: AIPickLeg) => void;
}) {
  const colors = useColors();
  const [expanded, setExpanded] = useState(false);
  const confColor = confidenceColor(parlay.confidence);

  return (
    <TouchableOpacity
      style={[styles.parlayCard, { backgroundColor: colors.card, borderColor: accent + "55" }]}
      onPress={() => { Haptics.selectionAsync(); setExpanded((e) => !e); }}
      activeOpacity={0.88}
    >
      {/* Header */}
      <View style={styles.parlayHeader}>
        <View style={[styles.parlayBadge, { backgroundColor: accent + "22", borderColor: accent + "55", borderWidth: 1 }]}>
          <Text style={[styles.parlayBadgeText, { color: accent }]}>
            {parlay.legs.length}-Leg Parlay
          </Text>
        </View>
        <Text style={[styles.parlayOdds, { color: accent }]}>{fmtOdds(parlay.combinedOdds)}</Text>
      </View>

      <Text style={[styles.parlayName, { color: colors.foreground }]}>{parlay.name}</Text>
      <Text style={[styles.parlayPayout, { color: colors.mutedForeground }]}>
        {combinedOddsPayoutStr(parlay.combinedOdds)}
      </Text>

      {/* Legs */}
      <View style={[styles.legList, { borderTopColor: colors.border }]}>
        {parlay.legs.map((leg, i) => (
          <View
            key={i}
            style={[
              styles.legRow,
              i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
            ]}
          >
            <View style={[styles.legDot, { backgroundColor: sportBadgeColor(leg.sport) }]} />
            <View style={styles.legInfo}>
              <Text style={[styles.legMatchup, { color: colors.mutedForeground }]} numberOfLines={1}>
                {leg.awayTeam && leg.homeTeam
                  ? `${leg.awayTeam} @ ${leg.homeTeam}`
                  : leg.homeTeam || leg.awayTeam || "Today's game"}
              </Text>
              <Text style={[styles.legPick, { color: colors.foreground }]}>
                {leg.player && !leg.pick.toLowerCase().includes(leg.player.toLowerCase())
                  ? `${leg.player} ${leg.pick}`
                  : leg.pick}
              </Text>
            </View>
            <Text style={[styles.legOdds, { color: accent }]}>{fmtOdds(leg.odds)}</Text>
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

      {/* Reasoning (expanded) */}
      {expanded && (
        <View style={[styles.reasoning, { borderTopColor: colors.border }]}>
          <View style={styles.reasoningHeader}>
            <Feather name="activity" size={13} color={accent} />
            <Text style={[styles.reasoningLabel, { color: accent }]}>Why this parlay?</Text>
          </View>
          <Text style={[styles.reasoningText, { color: colors.foreground }]}>{parlay.reasoning}</Text>
        </View>
      )}

      {/* Bet button */}
      <TouchableOpacity
        style={[styles.actionBtnFull, { backgroundColor: accent }]}
        onPress={(e) => { e.stopPropagation?.(); onBet(parlay.legs[0]); }}
      >
        <Feather name="external-link" size={14} color="#fff" />
        <Text style={styles.betBtnText}>Place Parlay Bet</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

// ─── Ladder parlay card ───────────────────────────────────────────────────────

const LADDER_ACCENT = "#10b981";

function fmtPayout(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

function LadderParlayCard({
  parlay,
  onBet,
}: {
  parlay: AILadderParlay;
  onBet: (leg: AIPickLeg) => void;
}) {
  const colors = useColors();
  const [expanded, setExpanded] = useState(false);
  const steps = parlay.steps ?? [];
  const finalPayout = steps[steps.length - 1]?.runningPayout ?? 0;

  const previewSteps = steps.length > 4
    ? [steps[0], steps[Math.floor(steps.length / 2)], steps[steps.length - 1]]
    : steps;

  return (
    <TouchableOpacity
      style={[styles.parlayCard, { backgroundColor: colors.card, borderColor: LADDER_ACCENT + "55" }]}
      onPress={() => { Haptics.selectionAsync(); setExpanded((e) => !e); }}
      activeOpacity={0.88}
    >
      {/* Header */}
      <View style={styles.parlayHeader}>
        <View style={[styles.parlayBadge, { backgroundColor: LADDER_ACCENT + "22", borderColor: LADDER_ACCENT + "44", borderWidth: 1 }]}>
          <Text style={[styles.parlayBadgeText, { color: LADDER_ACCENT }]}>
            {steps.length}-Leg Ladder
          </Text>
        </View>
        <Text style={[styles.parlayOdds, { color: LADDER_ACCENT }]}>{fmtOdds(parlay.combinedOdds)}</Text>
      </View>

      <Text style={[styles.parlayName, { color: colors.foreground }]}>{parlay.name}</Text>

      {/* Progression preview */}
      <View style={[ladderStyles.progressBar, { backgroundColor: LADDER_ACCENT + "10", borderColor: LADDER_ACCENT + "30" }]}>
        <View style={ladderStyles.progressItem}>
          <Text style={[ladderStyles.progressLabel, { color: colors.mutedForeground }]}>Stake</Text>
          <Text style={[ladderStyles.progressValue, { color: colors.foreground }]}>${parlay.startStake}</Text>
        </View>
        {previewSteps.map((step, i) => (
          <React.Fragment key={i}>
            <Feather name="arrow-right" size={11} color={LADDER_ACCENT} />
            <View style={ladderStyles.progressItem}>
              <Text style={[ladderStyles.progressLabel, { color: colors.mutedForeground }]}>
                Leg {i === previewSteps.length - 1 && steps.length > 4 ? steps.length : i + 1}
              </Text>
              <Text style={[ladderStyles.progressValue, { color: LADDER_ACCENT }]}>
                {fmtPayout(step.runningPayout)}
              </Text>
            </View>
          </React.Fragment>
        ))}
      </View>

      {/* Target badge */}
      <View style={ladderStyles.targetRow}>
        <Feather name="target" size={13} color={LADDER_ACCENT} />
        <Text style={[ladderStyles.targetText, { color: colors.mutedForeground }]}>
          Target: <Text style={{ color: LADDER_ACCENT, fontFamily: "Inter_700Bold" }}>${parlay.targetPayout.toLocaleString()}</Text>
          {"  "}·{"  "}
          Projected: <Text style={{ color: LADDER_ACCENT, fontFamily: "Inter_700Bold" }}>{fmtPayout(finalPayout)}</Text>
        </Text>
      </View>

      {/* Step-by-step list */}
      <View style={[styles.legList, { borderTopColor: colors.border }]}>
        {steps.map((step, i) => (
          <View
            key={i}
            style={[
              styles.legRow,
              i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
            ]}
          >
            <View style={[ladderStyles.stepNum, { backgroundColor: LADDER_ACCENT + "20" }]}>
              <Text style={[ladderStyles.stepNumText, { color: LADDER_ACCENT }]}>{i + 1}</Text>
            </View>
            <View style={styles.legInfo}>
              <Text style={[styles.legMatchup, { color: colors.mutedForeground }]} numberOfLines={1}>
                {step.leg.awayTeam && step.leg.homeTeam
                  ? `${step.leg.awayTeam} @ ${step.leg.homeTeam}`
                  : "Today's game"}
              </Text>
              <Text style={[styles.legPick, { color: colors.foreground }]}>{step.leg.pick}</Text>
            </View>
            <View style={ladderStyles.stepRight}>
              <Text style={[styles.legOdds, { color: LADDER_ACCENT }]}>{fmtOdds(step.leg.odds)}</Text>
              <Text style={[ladderStyles.stepPayout, { color: colors.mutedForeground }]}>
                → {fmtPayout(step.runningPayout)}
              </Text>
            </View>
          </View>
        ))}
      </View>

      {/* Confidence */}
      <View style={styles.confRow}>
        <View style={[styles.confBar, { backgroundColor: colors.border }]}>
          <View style={[styles.confFill, { backgroundColor: "#ef4444", width: `${parlay.confidence}%` as any }]} />
        </View>
        <Text style={[styles.confLabel, { color: "#ef4444" }]}>{parlay.confidence}% confidence</Text>
      </View>

      {/* Reasoning */}
      {expanded && (
        <View style={[styles.reasoning, { borderTopColor: colors.border }]}>
          <View style={styles.reasoningHeader}>
            <Feather name="trending-up" size={13} color={LADDER_ACCENT} />
            <Text style={[styles.reasoningLabel, { color: LADDER_ACCENT }]}>How the ladder works</Text>
          </View>
          <Text style={[styles.reasoningText, { color: colors.foreground }]}>{parlay.reasoning}</Text>
        </View>
      )}

      <TouchableOpacity
        style={[styles.actionBtnFull, { backgroundColor: LADDER_ACCENT }]}
        onPress={(e) => { e.stopPropagation?.(); onBet(parlay.legs[0]); }}
      >
        <Feather name="external-link" size={14} color="#fff" />
        <Text style={styles.betBtnText}>Place Ladder Parlay</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonCard({ height = 160 }: { height?: number }) {
  const colors = useColors();
  return (
    <View style={[styles.lockCard, { backgroundColor: colors.card, borderColor: colors.border, height }]}>
      <View style={[styles.skelLine, { width: "40%", backgroundColor: colors.border }]} />
      <View style={[styles.skelLine, { width: "75%", marginTop: 10, backgroundColor: colors.border }]} />
      <View style={[styles.skelLine, { width: "55%", marginTop: 8, backgroundColor: colors.border }]} />
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function AiPicksScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const [quickAdd, setQuickAdd] = useState<QuickAddBet | null>(null);
  const [selectedSport, setSelectedSport] = useState<SportKey>("all");
  const [bookmakerBet, setBookmakerBet] = useState<{
    matchup: string;
    pick: string;
    odds: number;
    sport?: string;
    preferredBookmaker?: string;
  } | null>(null);

  const sportParam = selectedSport === "all" ? undefined : selectedSport;
  const { data, isLoading, isFetching, refetch } = useGetAiPicks(
    sportParam ? { sport: sportParam } : undefined,
    { query: { staleTime: 15 * 60_000, gcTime: 15 * 60_000, refetchOnMount: true, refetchOnWindowFocus: false } as any },
  );
  const { mutate: doRefresh, isPending: isRefreshing } = useRefreshAiPicks();

  const lock = data?.lockOfTheDay ?? null;
  const safeParlay = data?.safeParlay ?? null;
  const lottoParlay = data?.lottoParlay ?? null;
  const gameParlay = data?.gameParlayOfTheDay ?? null;
  const propParlay = data?.propParlayOfTheDay ?? null;
  const mixParlay = data?.mixParlayOfTheDay ?? null;
  const hrParlay = data?.hrParlay ?? null;
  const goalScorerParlay = data?.goalScorerParlay ?? null;
  const threePtParlay = data?.threePtParlay ?? null;
  const tdParlay = data?.tdParlay ?? null;
  const nbaLadder = (data?.nbaLadder ?? null) as AILadderParlay | null;
  const mlbLadder = (data?.mlbLadder ?? null) as AILadderParlay | null;
  const nhlLadder = (data?.nhlLadder ?? null) as AILadderParlay | null;
  const nflLadder = (data?.nflLadder ?? null) as AILadderParlay | null;
  const isAI = data?.isAI ?? false;

  function openTrack(pick: AIPick) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setQuickAdd({
      matchup: formatMatchup(pick),
      pick: pick.pick,
      bookmaker: pick.bookmaker,
      odds: pick.odds,
    });
  }

  function openBet(pick: { awayTeam: string; homeTeam: string; pick: string; odds: number; bookmaker: string; sport?: string }) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setBookmakerBet({
      matchup: `${pick.awayTeam} @ ${pick.homeTeam}`,
      pick: pick.pick,
      odds: pick.odds,
      sport: pick.sport,
      preferredBookmaker: pick.bookmaker,
    });
  }

  function handleRefresh() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    doRefresh(undefined, { onSettled: () => refetch() });
  }

  function selectSport(key: SportKey) {
    if (key === selectedSport) return;
    Haptics.selectionAsync();
    setSelectedSport(key);
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }, isWeb && styles.webRoot]}>
      {/* ── Sport tab bar ── */}
      <View style={[styles.tabBarWrapper, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <FlatList
          data={SPORT_TABS}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={(item) => item.key}
          contentContainerStyle={styles.tabBarContent}
          renderItem={({ item }) => {
            const active = item.key === selectedSport;
            return (
              <TouchableOpacity
                onPress={() => selectSport(item.key)}
                style={[
                  styles.tabPill,
                  active
                    ? { backgroundColor: colors.primary }
                    : { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 },
                ]}
                activeOpacity={0.75}
              >
                <Text style={styles.tabIcon}>{item.icon}</Text>
                <Text style={[
                  styles.tabLabel,
                  { color: active ? "#fff" : colors.mutedForeground },
                  active && styles.tabLabelActive,
                ]}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            );
          }}
        />
      </View>

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
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <View style={[styles.aiBadge, {
                  backgroundColor: isAI ? colors.primary + "22" : colors.border,
                  borderColor: isAI ? colors.primary + "44" : colors.border,
                }]}>
                  <Feather name="cpu" size={11} color={isAI ? colors.primary : colors.mutedForeground} />
                  <Text style={[styles.aiBadgeText, { color: isAI ? colors.primary : colors.mutedForeground }]}>
                    {isAI ? "AI Generated" : "Model Picks"}
                  </Text>
                </View>
                {data.generatedAt ? (
                  <Text style={{ fontSize: 11, color: colors.mutedForeground }}>
                    Updated {new Date(data.generatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                  </Text>
                ) : null}
              </View>
              <Text style={[styles.summaryText, { color: colors.mutedForeground }]} numberOfLines={3}>
                {data.summary}
              </Text>
            </View>
            <TouchableOpacity
              onPress={handleRefresh}
              disabled={isRefreshing}
              hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
            >
              <Feather
                name="refresh-cw"
                size={18}
                color={colors.primary}
                style={isRefreshing ? { opacity: 0.4 } : undefined}
              />
            </TouchableOpacity>
          </View>
        ) : null}

        {isLoading ? (
          <>
            <SkeletonCard height={200} />
            <SkeletonCard height={240} />
            <SkeletonCard height={290} />
          </>
        ) : (
          <>
            {/* ── Lock of the Day ── */}
            <View style={styles.section}>
              <SectionHeader
                icon="🔒"
                label="Lock of the Day"
                sublabel="Highest confidence single pick"
                accent="#f59e0b"
              />
              {lock ? (
                <LockCard
                  pick={lock}
                  onTrack={() => openTrack(lock)}
                  onBet={() => openBet({ ...lock, sport: lock.sport })}
                />
              ) : (
                <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[styles.emptyCardText, { color: colors.mutedForeground }]}>
                    No lock available — pull to refresh.
                  </Text>
                </View>
              )}
            </View>

            {/* ── Safe Parlay ── */}
            <View style={styles.section}>
              <SectionHeader
                icon="⚡"
                label="Safe Parlay of the Day"
                sublabel="2–3 legs, solid value (+175 to +500)"
                accent="#22c55e"
              />
              {(safeParlay?.legs?.length ?? 0) > 0 ? (
                <ParlayCard
                  parlay={safeParlay!}
                  accent="#22c55e"
                  onBet={(leg) => openBet({ ...leg, pick: `${safeParlay!.name} (safe parlay)`, odds: safeParlay!.combinedOdds })}
                />
              ) : (
                <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[styles.emptyCardText, { color: colors.mutedForeground }]}>
                    No safe parlay — pull to refresh.
                  </Text>
                </View>
              )}
            </View>

            {/* ── Lotto Parlay ── */}
            <View style={styles.section}>
              <SectionHeader
                icon="🎰"
                label="Lotto Parlay of the Day"
                sublabel="4–6 legs, big payout (+800 to +3000)"
                accent="#a855f7"
              />
              {(lottoParlay?.legs?.length ?? 0) > 0 ? (
                <ParlayCard
                  parlay={lottoParlay!}
                  accent="#a855f7"
                  onBet={(leg) => openBet({ ...leg, pick: `${lottoParlay!.name} (lotto parlay)`, odds: lottoParlay!.combinedOdds })}
                />
              ) : (
                <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[styles.emptyCardText, { color: colors.mutedForeground }]}>No lotto parlay — pull to refresh.</Text>
                </View>
              )}
            </View>

            {/* ── Game Picks Parlay ── */}
            <View style={styles.section}>
              <SectionHeader
                icon="🏆"
                label="Game Picks Parlay"
                sublabel="Moneyline, spread & O/U only — no props"
                accent="#3b82f6"
              />
              {(gameParlay?.legs?.length ?? 0) > 0 ? (
                <ParlayCard
                  parlay={gameParlay!}
                  accent="#3b82f6"
                  onBet={(leg) => openBet({ ...leg, pick: `${gameParlay!.name} (game parlay)`, odds: gameParlay!.combinedOdds })}
                />
              ) : (
                <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[styles.emptyCardText, { color: colors.mutedForeground }]}>No game parlay — pull to refresh.</Text>
                </View>
              )}
            </View>

            {/* ── Player Props Parlay ── */}
            <View style={styles.section}>
              <SectionHeader
                icon="🎯"
                label="Player Props Parlay"
                sublabel="All player performance props"
                accent="#f97316"
              />
              {(propParlay?.legs?.length ?? 0) > 0 ? (
                <ParlayCard
                  parlay={propParlay!}
                  accent="#f97316"
                  onBet={(leg) => openBet({ ...leg, pick: `${propParlay!.name} (props parlay)`, odds: propParlay!.combinedOdds })}
                />
              ) : (
                <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[styles.emptyCardText, { color: colors.mutedForeground }]}>No props parlay — pull to refresh.</Text>
                </View>
              )}
            </View>

            {/* ── Mix Parlay ── */}
            <View style={styles.section}>
              <SectionHeader
                icon="🔀"
                label="Mix Parlay"
                sublabel="Game bets + player props combined"
                accent="#14b8a6"
              />
              {(mixParlay?.legs?.length ?? 0) > 0 ? (
                <ParlayCard
                  parlay={mixParlay!}
                  accent="#14b8a6"
                  onBet={(leg) => openBet({ ...leg, pick: `${mixParlay!.name} (mix parlay)`, odds: mixParlay!.combinedOdds })}
                />
              ) : (
                <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[styles.emptyCardText, { color: colors.mutedForeground }]}>No mix parlay — pull to refresh.</Text>
                </View>
              )}
            </View>

            {/* ── Divider: Sport-Specific Parlays ── */}
            <View style={[styles.dividerSection, { borderTopColor: colors.border }]}>
              <Text style={[styles.dividerLabel, { color: colors.mutedForeground }]}>SPORT PROP PARLAYS</Text>
            </View>

            {/* ── MLB Home Run Parlay ── */}
            <View style={styles.section}>
              <SectionHeader
                icon="💣"
                label="MLB Home Run Parlay"
                sublabel="Multi-HR bomber parlay · high variance"
                accent="#3b82f6"
              />
              {(hrParlay?.legs?.length ?? 0) > 0 ? (
                <ParlayCard
                  parlay={hrParlay!}
                  accent="#3b82f6"
                  onBet={(leg) => openBet({ ...leg, pick: `${hrParlay!.name} (HR parlay)`, odds: hrParlay!.combinedOdds })}
                />
              ) : (
                <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[styles.emptyCardText, { color: colors.mutedForeground }]}>No HR parlay today — check back when MLB games are on.</Text>
                </View>
              )}
            </View>

            {/* ── NHL Goal Scorer Parlay ── */}
            <View style={styles.section}>
              <SectionHeader
                icon="🏒"
                label="NHL Goal Scorer Parlay"
                sublabel="Anytime goal scorer combo"
                accent="#8b5cf6"
              />
              {(goalScorerParlay?.legs?.length ?? 0) > 0 ? (
                <ParlayCard
                  parlay={goalScorerParlay!}
                  accent="#8b5cf6"
                  onBet={(leg) => openBet({ ...leg, pick: `${goalScorerParlay!.name} (goal scorer parlay)`, odds: goalScorerParlay!.combinedOdds })}
                />
              ) : (
                <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[styles.emptyCardText, { color: colors.mutedForeground }]}>No goal scorer parlay — check back on NHL game days.</Text>
                </View>
              )}
            </View>

            {/* ── NBA 3PT Parlay ── */}
            <View style={styles.section}>
              <SectionHeader
                icon="🏀"
                label="NBA 3-Pointer Parlay"
                sublabel="Volume shooters from deep"
                accent="#f97316"
              />
              {(threePtParlay?.legs?.length ?? 0) > 0 ? (
                <ParlayCard
                  parlay={threePtParlay!}
                  accent="#f97316"
                  onBet={(leg) => openBet({ ...leg, pick: `${threePtParlay!.name} (3PT parlay)`, odds: threePtParlay!.combinedOdds })}
                />
              ) : (
                <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[styles.emptyCardText, { color: colors.mutedForeground }]}>No 3PT parlay — check back on NBA game days.</Text>
                </View>
              )}
            </View>

            {/* ── NFL TD Parlay ── */}
            <View style={styles.section}>
              <SectionHeader
                icon="🏈"
                label="NFL TD Scorer Parlay"
                sublabel="Anytime touchdown combo"
                accent="#22c55e"
              />
              {(tdParlay?.legs?.length ?? 0) > 0 ? (
                <ParlayCard
                  parlay={tdParlay!}
                  accent="#22c55e"
                  onBet={(leg) => openBet({ ...leg, pick: `${tdParlay!.name} (TD parlay)`, odds: tdParlay!.combinedOdds })}
                />
              ) : (
                <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[styles.emptyCardText, { color: colors.mutedForeground }]}>No TD parlay — check back on NFL game days.</Text>
                </View>
              )}
            </View>

            {/* ── Divider: Ladder Parlays ── */}
            <View style={[styles.dividerSection, { borderTopColor: colors.border }]}>
              <Text style={[styles.dividerLabel, { color: colors.mutedForeground }]}>LADDER PARLAYS · $10 → $10K</Text>
            </View>
            <View style={[styles.ladderIntro, { backgroundColor: LADDER_ACCENT + "10", borderColor: LADDER_ACCENT + "30" }]}>
              <Feather name="trending-up" size={14} color={LADDER_ACCENT} />
              <Text style={[styles.ladderIntroText, { color: colors.mutedForeground }]}>
                Each leg compounds on the last. If all hit, a $10 stake turns into $10,000+.
              </Text>
            </View>

            {/* ── NBA Ladder ── */}
            <View style={styles.section}>
              <SectionHeader
                icon="🏀"
                label="NBA $10 → $10K Ladder"
                sublabel="Stack NBA props + game lines"
                accent={LADDER_ACCENT}
              />
              {nbaLadder && (nbaLadder.steps?.length ?? 0) >= 3 ? (
                <LadderParlayCard
                  parlay={nbaLadder}
                  onBet={(leg) => openBet({ ...leg, pick: `${nbaLadder.name} (ladder)`, odds: nbaLadder.combinedOdds })}
                />
              ) : (
                <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[styles.emptyCardText, { color: colors.mutedForeground }]}>NBA ladder not available today.</Text>
                </View>
              )}
            </View>

            {/* ── MLB Ladder ── */}
            <View style={styles.section}>
              <SectionHeader
                icon="⚾"
                label="MLB $10 → $10K Ladder"
                sublabel="HR props + underdog MLs"
                accent={LADDER_ACCENT}
              />
              {mlbLadder && (mlbLadder.steps?.length ?? 0) >= 3 ? (
                <LadderParlayCard
                  parlay={mlbLadder}
                  onBet={(leg) => openBet({ ...leg, pick: `${mlbLadder.name} (ladder)`, odds: mlbLadder.combinedOdds })}
                />
              ) : (
                <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[styles.emptyCardText, { color: colors.mutedForeground }]}>MLB ladder not available today.</Text>
                </View>
              )}
            </View>

            {/* ── NHL Ladder ── */}
            <View style={styles.section}>
              <SectionHeader
                icon="🏒"
                label="NHL $10 → $10K Ladder"
                sublabel="Goal scorers + puck line underdogs"
                accent={LADDER_ACCENT}
              />
              {nhlLadder && (nhlLadder.steps?.length ?? 0) >= 3 ? (
                <LadderParlayCard
                  parlay={nhlLadder}
                  onBet={(leg) => openBet({ ...leg, pick: `${nhlLadder.name} (ladder)`, odds: nhlLadder.combinedOdds })}
                />
              ) : (
                <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[styles.emptyCardText, { color: colors.mutedForeground }]}>NHL ladder not available today.</Text>
                </View>
              )}
            </View>

            {/* ── NFL Ladder ── */}
            <View style={styles.section}>
              <SectionHeader
                icon="🏈"
                label="NFL $10 → $10K Ladder"
                sublabel="TD scorers + yardage props"
                accent={LADDER_ACCENT}
              />
              {nflLadder && (nflLadder.steps?.length ?? 0) >= 3 ? (
                <LadderParlayCard
                  parlay={nflLadder}
                  onBet={(leg) => openBet({ ...leg, pick: `${nflLadder.name} (ladder)`, odds: nflLadder.combinedOdds })}
                />
              ) : (
                <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[styles.emptyCardText, { color: colors.mutedForeground }]}>NFL ladder not available today.</Text>
                </View>
              )}
            </View>
          </>
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

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },
  webRoot: { maxWidth: 800, alignSelf: "center", width: "100%" },
  scroll: { padding: 16, gap: 0 },
  webScroll: { paddingTop: 24 },

  summaryBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
    marginBottom: 20,
  },
  summaryLeft: { flex: 1, gap: 6 },
  summaryText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
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

  section: { marginBottom: 24 },

  lockCard: {
    borderRadius: 18,
    borderWidth: 1.5,
    overflow: "hidden",
    gap: 0,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 4,
  },
  lockStrip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
  },
  lockStripLeft: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  lockMatchup: { fontSize: 13, fontFamily: "Inter_500Medium", flex: 1 },
  lockBody: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingTop: 12,
    gap: 8,
  },
  lockPickLeft: { flex: 1, gap: 4 },
  lockPlayer: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  lockPick: { fontSize: 20, fontFamily: "Inter_700Bold", lineHeight: 26 },
  lockOddsBlock: { alignItems: "flex-end" },
  lockOdds: { fontSize: 28, fontFamily: "Inter_700Bold" },

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
  gameTime: { fontSize: 12, fontFamily: "Inter_400Regular" },
  bookmakerText: { fontSize: 12, fontFamily: "Inter_400Regular" },

  confRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  confBar: { flex: 1, height: 5, borderRadius: 3, overflow: "hidden" },
  confFill: { height: "100%", borderRadius: 3 },
  confLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", minWidth: 110, textAlign: "right" },

  reasoning: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 4,
    gap: 8,
  },
  reasoningHeader: { flexDirection: "row", alignItems: "center", gap: 5 },
  reasoningLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  reasoningText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
  tagsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tag: { borderRadius: 5, paddingHorizontal: 7, paddingVertical: 3 },
  tagText: { fontSize: 10, fontFamily: "Inter_400Regular" },

  actions: {
    flexDirection: "row",
    gap: 8,
    padding: 14,
    paddingTop: 10,
  },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 11,
    borderRadius: 12,
    gap: 5,
  },
  actionBtnFull: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 12,
    gap: 5,
    margin: 14,
    marginTop: 4,
  },
  trackBtn: { borderWidth: 1 },
  actionBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  betBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" },

  parlayCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    gap: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
  parlayHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  parlayBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  parlayBadgeText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  parlayOdds: { fontSize: 26, fontFamily: "Inter_700Bold" },
  parlayName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  parlayPayout: { fontSize: 12, fontFamily: "Inter_400Regular" },

  legList: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8, gap: 0 },
  legRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, gap: 10 },
  legDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  legInfo: { flex: 1, gap: 2 },
  legMatchup: { fontSize: 11, fontFamily: "Inter_400Regular" },
  legPick: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  legOdds: { fontSize: 14, fontFamily: "Inter_700Bold" },

  emptyCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 24,
    alignItems: "center",
  },
  emptyCardText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },

  skelLine: { height: 12, borderRadius: 6, opacity: 0.4 },

  tabBarWrapper: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
  },
  tabBarContent: {
    paddingHorizontal: 16,
    gap: 7,
  },
  tabPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 10,
  },
  tabIcon: { fontSize: 13 },
  tabLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },

  dividerSection: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 20,
    marginBottom: 16,
    alignItems: "center",
  },
  dividerLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 1.2,
  },
  ladderIntro: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 20,
  },
  ladderIntroText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },
  tabLabelActive: { fontFamily: "Inter_700Bold" },
});

// ─── Ladder-specific styles ───────────────────────────────────────────────────

const ladderStyles = StyleSheet.create({
  progressBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    flexWrap: "wrap",
  },
  progressItem: {
    alignItems: "center",
    gap: 1,
  },
  progressLabel: {
    fontSize: 9,
    fontFamily: "Inter_400Regular",
  },
  progressValue: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
  },
  targetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
  },
  targetText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  stepNum: {
    width: 22,
    height: 22,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  stepNumText: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
  },
  stepRight: {
    alignItems: "flex-end",
    gap: 1,
  },
  stepPayout: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
  },
});
