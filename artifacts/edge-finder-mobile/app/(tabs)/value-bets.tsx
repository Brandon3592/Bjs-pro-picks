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

function fmtMoney(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

function calcCombinedOdds(legs: AIPickLeg[]): number {
  const dec = legs.reduce((acc, l) => {
    return acc * (l.odds > 0 ? l.odds / 100 + 1 : 100 / Math.abs(l.odds) + 1);
  }, 1);
  const net = dec - 1;
  return net >= 1 ? Math.round(net * 100) : -Math.round(100 / net);
}

function LadderParlayCard({
  parlay,
  onBet,
}: {
  parlay: AILadderParlay;
  onBet: (leg: AIPickLeg) => void;
}) {
  const colors = useColors();
  const [showPlan, setShowPlan] = useState(false);
  const steps = parlay.steps ?? [];
  const today = steps[0];
  const finalStep = steps[steps.length - 1];

  if (!today || !today.legs?.length) return null;

  const todayCombined = calcCombinedOdds(today.legs);

  return (
    <View style={[styles.parlayCard, { backgroundColor: colors.card, borderColor: LADDER_ACCENT + "44" }]}>
      {/* Header row */}
      <View style={styles.parlayHeader}>
        <View style={[styles.parlayBadge, { backgroundColor: LADDER_ACCENT + "22", borderColor: LADDER_ACCENT + "44", borderWidth: 1 }]}>
          <Text style={[styles.parlayBadgeText, { color: LADDER_ACCENT }]}>Daily Ladder</Text>
        </View>
        <Text style={[ladderStyles.dayLabel, { color: colors.mutedForeground }]}>
          Day 1 of {parlay.totalDays} · ${parlay.startStake} → ${parlay.targetPayout.toLocaleString()}
        </Text>
      </View>

      {/* TODAY'S BET — 2-leg parlay */}
      <View style={[ladderStyles.todayBox, { backgroundColor: LADDER_ACCENT + "12", borderColor: LADDER_ACCENT + "40" }]}>
        <Text style={[ladderStyles.todayLabel, { color: LADDER_ACCENT }]}>TODAY'S 2-LEG PARLAY</Text>

        {today.legs.map((leg, li) => (
          <View key={li} style={[ladderStyles.legBullet, li > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: LADDER_ACCENT + "30" }]}>
            <View style={[ladderStyles.legNumBadge, { backgroundColor: li === 0 ? LADDER_ACCENT : LADDER_ACCENT + "70" }]}>
              <Text style={ladderStyles.legNumText}>{li + 1}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[ladderStyles.todayPick, { color: colors.foreground }]} numberOfLines={2}>{leg.pick}</Text>
              <Text style={[ladderStyles.todayMatchup, { color: colors.mutedForeground }]} numberOfLines={1}>
                {leg.awayTeam && leg.homeTeam ? `${leg.awayTeam} @ ${leg.homeTeam}` : leg.homeTeam || "Today's game"} · {leg.bookmaker}
              </Text>
            </View>
            <View style={[ladderStyles.oddsBadge, { backgroundColor: LADDER_ACCENT + "22", borderColor: LADDER_ACCENT + "55" }]}>
              <Text style={[ladderStyles.oddsBadgeText, { color: LADDER_ACCENT }]}>{fmtOdds(leg.odds)}</Text>
            </View>
          </View>
        ))}

        <View style={ladderStyles.todayStakeRow}>
          <View style={[ladderStyles.stakeBox, { backgroundColor: colors.background }]}>
            <Text style={[ladderStyles.stakeLabel, { color: colors.mutedForeground }]}>Bet</Text>
            <Text style={[ladderStyles.stakeValue, { color: colors.foreground }]}>${today.stake.toFixed(0)}</Text>
          </View>
          <Feather name="arrow-right" size={16} color={LADDER_ACCENT} />
          <View style={[ladderStyles.stakeBox, { backgroundColor: colors.background }]}>
            <Text style={[ladderStyles.stakeLabel, { color: colors.mutedForeground }]}>Win</Text>
            <Text style={[ladderStyles.stakeValue, { color: LADDER_ACCENT }]}>${today.targetWin.toFixed(0)}</Text>
          </View>
          <View style={[ladderStyles.oddsBadge, { backgroundColor: LADDER_ACCENT + "22", borderColor: LADDER_ACCENT + "55" }]}>
            <Text style={[ladderStyles.oddsBadgeText, { color: LADDER_ACCENT }]}>{fmtOdds(todayCombined)}</Text>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.actionBtnFull, { backgroundColor: LADDER_ACCENT, marginTop: 10 }]}
          onPress={() => onBet(today.legs[0])}
        >
          <Feather name="external-link" size={14} color="#fff" />
          <Text style={styles.betBtnText}>Place Today's 2-Leg Bet</Text>
        </TouchableOpacity>
      </View>

      {/* Day-by-day dot track */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={ladderStyles.dotTrack}>
        <View style={ladderStyles.dotRow}>
          {steps.map((step, i) => (
            <View key={i} style={ladderStyles.dotItem}>
              <View style={[
                ladderStyles.dot,
                i === 0
                  ? { backgroundColor: LADDER_ACCENT }
                  : { backgroundColor: colors.border },
              ]}>
                <Text style={[ladderStyles.dotDay, { color: i === 0 ? "#fff" : colors.mutedForeground }]}>
                  {step.day}
                </Text>
              </View>
              <Text style={[ladderStyles.dotAmount, { color: i === 0 ? LADDER_ACCENT : colors.mutedForeground }]}>
                {fmtMoney(step.targetWin)}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>

      {/* Full plan toggle */}
      <TouchableOpacity
        style={ladderStyles.planToggle}
        onPress={() => { Haptics.selectionAsync(); setShowPlan((v) => !v); }}
      >
        <Text style={[ladderStyles.planToggleText, { color: colors.mutedForeground }]}>
          {showPlan ? "Hide" : "See"} full {steps.length}-day plan
        </Text>
        <Feather name={showPlan ? "chevron-up" : "chevron-down"} size={14} color={colors.mutedForeground} />
      </TouchableOpacity>

      {showPlan && (
        <View style={[ladderStyles.planList, { borderTopColor: colors.border }]}>
          {steps.map((step, i) => {
            const stepLegs = step.legs ?? [];
            const stepCombined = stepLegs.length >= 2 ? calcCombinedOdds(stepLegs) : stepLegs[0]?.odds ?? 0;
            return (
              <View
                key={i}
                style={[
                  ladderStyles.planRow,
                  i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
                  i === 0 && { backgroundColor: LADDER_ACCENT + "08" },
                ]}
              >
                <View style={[ladderStyles.stepNum, { backgroundColor: i === 0 ? LADDER_ACCENT : LADDER_ACCENT + "20" }]}>
                  <Text style={[ladderStyles.stepNumText, { color: i === 0 ? "#fff" : LADDER_ACCENT }]}>{step.day}</Text>
                </View>
                <View style={[styles.legInfo, { gap: 2 }]}>
                  {stepLegs.map((leg, li) => (
                    <Text key={li} style={[styles.legPick, { color: li === 0 ? colors.foreground : colors.mutedForeground, fontSize: li === 0 ? 13 : 11 }]} numberOfLines={1}>
                      {li + 1}. {leg.pick}
                    </Text>
                  ))}
                </View>
                <View style={ladderStyles.stepRight}>
                  <Text style={[styles.legOdds, { color: LADDER_ACCENT }]}>{fmtOdds(stepCombined)}</Text>
                  <Text style={[ladderStyles.stepPayout, { color: colors.mutedForeground }]}>
                    ${step.stake.toFixed(0)} → {fmtMoney(step.targetWin)}
                  </Text>
                </View>
              </View>
            );
          })}

          {/* Final payout callout */}
          <View style={[ladderStyles.finalCallout, { backgroundColor: LADDER_ACCENT + "12", borderColor: LADDER_ACCENT + "30" }]}>
            <Feather name="target" size={14} color={LADDER_ACCENT} />
            <Text style={[ladderStyles.finalCalloutText, { color: colors.mutedForeground }]}>
              Win all {steps.length} days in a row:{" "}
              <Text style={{ color: LADDER_ACCENT, fontFamily: "Inter_700Bold" }}>
                {fmtMoney(finalStep?.targetWin ?? 0)}
              </Text>
            </Text>
          </View>

          {/* Reasoning */}
          <View style={[styles.reasoning, { borderTopColor: colors.border }]}>
            <View style={styles.reasoningHeader}>
              <Feather name="info" size={13} color={LADDER_ACCENT} />
              <Text style={[styles.reasoningLabel, { color: LADDER_ACCENT }]}>How it works</Text>
            </View>
            <Text style={[styles.reasoningText, { color: colors.foreground }]}>{parlay.reasoning}</Text>
          </View>
        </View>
      )}
    </View>
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
  // Sport-specific parlays (used on individual sport tabs)
  const safeParlay = data?.safeParlay ?? null;
  const lottoParlay = data?.lottoParlay ?? null;
  const gameParlay = data?.gameParlayOfTheDay ?? null;
  const propParlay = data?.propParlayOfTheDay ?? null;
  const mixParlay = data?.mixParlayOfTheDay ?? null;
  // Cross-sport parlays (used on All Sports tab — one leg per sport)
  const allSafeParlay = (data as any)?.allSafeParlay ?? null;
  const allLottoParlay = (data as any)?.allLottoParlay ?? null;
  const allGameParlay = (data as any)?.allGameParlay ?? null;
  const allPropsParlay = (data as any)?.allPropsParlay ?? null;
  const allMixParlay = (data as any)?.allMixParlay ?? null;
  // Pick the right set based on selected tab
  const activeParlay = {
    safe: selectedSport === "all" ? allSafeParlay : safeParlay,
    lotto: selectedSport === "all" ? allLottoParlay : lottoParlay,
    game: selectedSport === "all" ? allGameParlay : gameParlay,
    props: selectedSport === "all" ? allPropsParlay : propParlay,
    mix: selectedSport === "all" ? allMixParlay : mixParlay,
  };
  const hrParlay = data?.hrParlay ?? null;
  const goalScorerParlay = data?.goalScorerParlay ?? null;
  const threePtParlay = data?.threePtParlay ?? null;
  const tdParlay = data?.tdParlay ?? null;
  const allLadder = (data?.allLadder ?? null) as AILadderParlay | null;
  const nbaLadder = (data?.nbaLadder ?? null) as AILadderParlay | null;
  const mlbLadder = (data?.mlbLadder ?? null) as AILadderParlay | null;
  const nhlLadder = (data?.nhlLadder ?? null) as AILadderParlay | null;
  const nflLadder = (data?.nflLadder ?? null) as AILadderParlay | null;
  const isAI = data?.isAI ?? false;

  const activeLadder =
    selectedSport === "all" ? allLadder :
    selectedSport === "NBA" ? nbaLadder :
    selectedSport === "MLB" ? mlbLadder :
    selectedSport === "NHL" ? nhlLadder :
    selectedSport === "NFL" ? nflLadder :
    null;

  const ladderSportIcon =
    selectedSport === "all" ? "🏆" :
    selectedSport === "NBA" ? "🏀" :
    selectedSport === "MLB" ? "⚾" :
    selectedSport === "NHL" ? "🏒" :
    selectedSport === "NFL" ? "🏈" : "🏆";

  const ladderSportLabel = selectedSport === "all" ? "All Sports" : selectedSport;

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

            {/* ── Generic parlays — hidden on NFL tab (off-season, no NFL data) ── */}
            {selectedSport !== "NFL" && (
              <>
                {/* ── Safe Parlay ── */}
                <View style={styles.section}>
                  <SectionHeader
                    icon="⚡"
                    label="Safe Parlay of the Day"
                    sublabel="2–3 legs, solid value (+175 to +500)"
                    accent="#22c55e"
                  />
                  {(activeParlay.safe?.legs?.length ?? 0) > 0 ? (
                    <ParlayCard
                      parlay={activeParlay.safe!}
                      accent="#22c55e"
                      onBet={(leg) => openBet({ ...leg, pick: `${activeParlay.safe!.name} (safe parlay)`, odds: activeParlay.safe!.combinedOdds })}
                    />
                  ) : (
                    <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                      <Text style={[styles.emptyCardText, { color: colors.mutedForeground }]}>No safe parlay — pull to refresh.</Text>
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
                  {(activeParlay.lotto?.legs?.length ?? 0) > 0 ? (
                    <ParlayCard
                      parlay={activeParlay.lotto!}
                      accent="#a855f7"
                      onBet={(leg) => openBet({ ...leg, pick: `${activeParlay.lotto!.name} (lotto parlay)`, odds: activeParlay.lotto!.combinedOdds })}
                    />
                  ) : (
                    <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                      <Text style={[styles.emptyCardText, { color: colors.mutedForeground }]}>No lotto parlay — pull to refresh.</Text>
                    </View>
                  )}
                </View>

                {/* ── Game Picks Parlay ── */}
                {selectedSport !== "all" && (
                  <View style={styles.section}>
                    <SectionHeader
                      icon="🏆"
                      label="Game Picks Parlay"
                      sublabel="Moneyline, spread & O/U only — no props"
                      accent="#3b82f6"
                    />
                    {(activeParlay.game?.legs?.length ?? 0) > 0 ? (
                      <ParlayCard
                        parlay={activeParlay.game!}
                        accent="#3b82f6"
                        onBet={(leg) => openBet({ ...leg, pick: `${activeParlay.game!.name} (game parlay)`, odds: activeParlay.game!.combinedOdds })}
                      />
                    ) : (
                      <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                        <Text style={[styles.emptyCardText, { color: colors.mutedForeground }]}>No game parlay — pull to refresh.</Text>
                      </View>
                    )}
                  </View>
                )}

                {/* ── Player Props Parlay ── */}
                <View style={styles.section}>
                  <SectionHeader
                    icon="🎯"
                    label="Player Props Parlay"
                    sublabel="All player performance props"
                    accent="#f97316"
                  />
                  {(activeParlay.props?.legs?.length ?? 0) > 0 ? (
                    <ParlayCard
                      parlay={activeParlay.props!}
                      accent="#f97316"
                      onBet={(leg) => openBet({ ...leg, pick: `${activeParlay.props!.name} (props parlay)`, odds: activeParlay.props!.combinedOdds })}
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
                  {(activeParlay.mix?.legs?.length ?? 0) > 0 ? (
                    <ParlayCard
                      parlay={activeParlay.mix!}
                      accent="#14b8a6"
                      onBet={(leg) => openBet({ ...leg, pick: `${activeParlay.mix!.name} (mix parlay)`, odds: activeParlay.mix!.combinedOdds })}
                    />
                  ) : (
                    <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                      <Text style={[styles.emptyCardText, { color: colors.mutedForeground }]}>No mix parlay — pull to refresh.</Text>
                    </View>
                  )}
                </View>
              </>
            )}

            {/* ── Divider: Sport-Specific Parlays ── */}
            {(selectedSport === "MLB" || selectedSport === "NHL" || selectedSport === "NBA" || selectedSport === "NFL") && (
              <View style={[styles.dividerSection, { borderTopColor: colors.border }]}>
                <Text style={[styles.dividerLabel, { color: colors.mutedForeground }]}>SPORT PROP PARLAYS</Text>
              </View>
            )}

            {/* ── MLB Home Run Parlay — MLB tab only ── */}
            {selectedSport === "MLB" && (
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
                    <Text style={[styles.emptyCardText, { color: colors.mutedForeground }]}>Home run prop odds haven't been posted yet — check back closer to first pitch.</Text>
                  </View>
                )}
              </View>
            )}

            {/* ── NHL Goal Scorer Parlay — NHL tab only ── */}
            {selectedSport === "NHL" && (
              <View style={styles.section}>
                <SectionHeader
                  icon="🏒"
                  label="NHL Points Parlay"
                  sublabel="Anytime goal or assist combo"
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
            )}

            {/* ── NBA 3PT Parlay — NBA tab only ── */}
            {selectedSport === "NBA" && (
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
            )}

            {/* ── NFL TD Parlay — NFL tab only ── */}
            {selectedSport === "NFL" && (
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
            )}

            {/* ── Daily Ladder (per sport tab) ── */}
            <View style={[styles.dividerSection, { borderTopColor: colors.border }]}>
              <Text style={[styles.dividerLabel, { color: colors.mutedForeground }]}>DAILY LADDER · $10 → $10K</Text>
            </View>

            <View style={styles.section}>
              <SectionHeader
                icon={ladderSportIcon}
                label={`${ladderSportLabel} Daily Ladder`}
                sublabel="Win today's bet → roll winnings to tomorrow"
                accent={LADDER_ACCENT}
              />
              {activeLadder && (activeLadder.steps?.length ?? 0) >= 1 ? (
                <LadderParlayCard
                  parlay={activeLadder}
                  onBet={(leg) => openBet({ ...leg })}
                />
              ) : (
                <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[styles.emptyCardText, { color: colors.mutedForeground }]}>
                    {selectedSport === "NFL" || selectedSport === "NHL"
                      ? `No ${ladderSportLabel} ladder — check back when games are on.`
                      : `No ${ladderSportLabel} ladder today — pull to refresh.`}
                  </Text>
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
  // Header
  dayLabel: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },

  // TODAY'S BET box
  todayBox: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginTop: 6,
    gap: 4,
  },
  todayLabel: {
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    letterSpacing: 1,
    marginBottom: 2,
  },
  todayPick: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
    lineHeight: 20,
  },
  todayMatchup: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginBottom: 2,
  },

  // Leg bullets inside TODAY's box
  legBullet: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingVertical: 8,
  },
  legNumBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  legNumText: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    color: "#fff",
  },
  todayStakeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
  },
  stakeBox: {
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 2,
  },
  stakeLabel: {
    fontSize: 10,
    fontFamily: "Inter_500Medium",
    letterSpacing: 0.5,
  },
  stakeValue: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
  },
  oddsBadge: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginLeft: "auto" as any,
  },
  oddsBadgeText: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
  },

  // Day dot track
  dotTrack: {
    marginTop: 14,
  },
  dotRow: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 2,
    paddingBottom: 4,
  },
  dotItem: {
    alignItems: "center",
    gap: 4,
    minWidth: 44,
  },
  dot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  dotDay: {
    fontSize: 12,
    fontFamily: "Inter_700Bold",
  },
  dotAmount: {
    fontSize: 10,
    fontFamily: "Inter_500Medium",
  },

  // Plan toggle
  planToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    marginTop: 10,
    paddingTop: 10,
  },
  planToggleText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },

  // Plan list
  planList: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 6,
    paddingTop: 4,
  },
  planRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 9,
    paddingHorizontal: 4,
  },

  // Final callout
  finalCallout: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 8,
  },
  finalCalloutText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    flex: 1,
  },

  // Shared step styles
  stepNum: {
    width: 24,
    height: 24,
    borderRadius: 7,
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
    marginLeft: "auto" as any,
  },
  stepPayout: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
  },
});
