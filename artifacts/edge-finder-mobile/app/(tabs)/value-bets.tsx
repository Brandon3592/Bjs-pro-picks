import {
  useGetAiPicks,
  useRefreshAiPicks,
  useGetLadderProgress,
  useSettleLadder,
  getGetLadderProgressQueryKey,
  type LadderProgress,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useState, useEffect } from "react";
import {
  ActivityIndicator,
  Platform,
  RefreshControl,
  ScrollView,
  Share,
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

// Ordered list of all possible sport tabs. Only those returned in activeSports are shown.
const ALL_POSSIBLE_TABS = [
  { key: "all",     label: "All Sports", icon: "🌐" },
  { key: "NBA",     label: "NBA",        icon: "🏀" },
  { key: "MLB",     label: "MLB",        icon: "⚾" },
  { key: "NHL",     label: "NHL",        icon: "🏒" },
  { key: "NFL",     label: "NFL",        icon: "🏈" },
  { key: "NCAAB",   label: "NCAAB",      icon: "🎓" },
  { key: "NCAAF",   label: "NCAAF",      icon: "🎓" },
  { key: "NCAABSB", label: "NCAABSB",    icon: "🥎" },
  { key: "WNBA",    label: "WNBA",       icon: "🏀" },
  { key: "Soccer",  label: "Soccer",     icon: "⚽" },
  { key: "MMA",     label: "MMA",        icon: "🥊" },
  { key: "Boxing",  label: "Boxing",     icon: "🥊" },
  { key: "Tennis",  label: "Tennis",     icon: "🎾" },
  { key: "Golf",    label: "Golf",       icon: "⛳" },
];

// NFL season: Sept (9) through Feb (2). Show content ~2 weeks before kickoff (mid-Aug).
const NFL_SEASON_ACTIVE = (() => {
  const m = new Date().getMonth() + 1;
  return m >= 8 || m <= 2;
})();

type SportKey = string;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtOdds(o: number) {
  return o > 0 ? `+${o}` : `${o}`;
}

function impliedProb(odds: number): string {
  const p = odds > 0 ? 100 / (100 + odds) : Math.abs(odds) / (Math.abs(odds) + 100);
  return `${(p * 100).toFixed(0)}%`;
}

function combinedOddsPayoutStr(odds: number): string {
  const decimal = odds > 0 ? odds / 100 + 1 : 100 / Math.abs(odds) + 1;
  const payout = ((decimal - 1) * 100).toFixed(0);
  return `$${payout} profit per $100 wagered`;
}

function sportBadgeColor(sport: string): string {
  switch (sport) {
    case "NBA":    return "#F97316";
    case "MLB":    return "#3B82F6";
    case "NHL":    return "#8B5CF6";
    case "NFL":    return "#22C55E";
    case "Tennis": return "#EC4899";
    case "Golf":   return "#10B981";
    case "Soccer": return "#14B8A6";
    case "MMA":    return "#EF4444";
    case "Boxing": return "#EF4444";
    default:       return "#6B7280";
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
  onLog,
  onBet,
}: {
  pick: AIPick;
  onTrack: () => void;
  onLog: () => void;
  onBet: () => void;
}) {
  const colors = useColors();
  const [expanded, setExpanded] = useState(true);
  const GOLD = "#f59e0b";
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


      {/* AI Reasoning */}
      {expanded && (
        <View style={[styles.reasoning, { borderTopColor: colors.border }]}>
          <View style={styles.reasoningHeader}>
            <Feather name="cpu" size={13} color={GOLD} />
            <Text style={[styles.reasoningLabel, { color: GOLD }]}>Model Analysis</Text>
          </View>
          {pick.tags?.length > 0 && (
            <View style={styles.tagsRow}>
              {pick.tags.map((tag) => (
                <View key={tag} style={[styles.tag, { backgroundColor: GOLD + "22" }]}>
                  <Text style={[styles.tagText, { color: GOLD }]}>{tag.replace(/_/g, " ")}</Text>
                </View>
              ))}
            </View>
          )}
          <View style={{ gap: 5 }}>
            {pick.reasoning.split(/\.\s+/).filter((s) => s.trim().length > 6).map((sentence, i) => (
              <View key={i} style={{ flexDirection: "row", gap: 7, alignItems: "flex-start" }}>
                <Text style={{ color: GOLD, fontSize: 14, lineHeight: 19 }}>·</Text>
                <Text style={[styles.reasoningText, { color: colors.foreground, flex: 1 }]}>
                  {sentence.replace(/\.$/, "")}
                </Text>
              </View>
            ))}
          </View>
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
          style={[styles.actionBtn, { borderWidth: 1, borderColor: GOLD + "66" }]}
          onPress={(e) => { e.stopPropagation?.(); onLog(); }}
        >
          <Feather name="plus-circle" size={14} color={GOLD} />
          <Text style={[styles.actionBtnText, { color: GOLD }]}>Log Bet</Text>
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
  onLog,
}: {
  parlay: AIParlay;
  accent: string;
  onBet: (leg: AIPickLeg) => void;
  onLog: () => void;
}) {
  const colors = useColors();
  const [expanded, setExpanded] = useState(false);

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
            <View style={{ alignItems: "flex-end", gap: 2 }}>
              <Text style={[styles.legOdds, { color: accent }]}>{fmtOdds(leg.odds)}</Text>
              <Text style={{ fontSize: 10, fontFamily: "Inter_400Regular", color: "#6b7280" }}>
                {formatTime(leg.startTime)}
              </Text>
            </View>
          </View>
        ))}
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

      {/* Action row */}
      <View style={styles.parlayActions}>
        <TouchableOpacity
          style={[styles.parlayShareIcon, { borderColor: accent + "55" }]}
          onPress={(e) => {
            e.stopPropagation?.();
            Haptics.selectionAsync();
            const legLines = parlay.legs.map((l, i) =>
              `  ${i + 1}. ${l.player ? `${l.player} — ` : ""}${l.pick} (${fmtOdds(l.odds)}) via ${l.bookmaker}`
            ).join("\n");
            Share.share({
              message: `🎯 ${parlay.name}\n${fmtOdds(parlay.combinedOdds)} combined odds\n\n${legLines}\n\nGenerated by BJ's Pro Picks`,
              title: parlay.name,
            }).catch(() => {});
          }}
        >
          <Feather name="share-2" size={14} color={accent} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.shareBtn, { borderColor: accent + "55", flex: 1 }]}
          onPress={(e) => { e.stopPropagation?.(); onLog(); }}
        >
          <Feather name="plus-circle" size={14} color={accent} />
          <Text style={[styles.shareBtnText, { color: accent }]}>Log Bet</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.shareBtn, { backgroundColor: accent, borderColor: accent, flex: 1.5 }]}
          onPress={(e) => { e.stopPropagation?.(); onBet(parlay.legs[0]); }}
        >
          <Feather name="external-link" size={14} color="#fff" />
          <Text style={[styles.shareBtnText, { color: "#fff" }]}>Place Bet</Text>
        </TouchableOpacity>
      </View>
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

function DailyLadderCard({
  parlay,
  progress,
  onBet,
  onLog,
  onSettle,
  isSettling,
}: {
  parlay: AILadderParlay;
  progress: LadderProgress | undefined;
  onBet: (legs: AIPickLeg[]) => void;
  onLog: () => void;
  onSettle: (won: boolean) => void;
  isSettling: boolean;
}) {
  const colors = useColors();
  const steps = parlay.steps ?? [];
  const today = steps[0];

  if (!today || !today.legs?.length) return null;

  const currentDay = progress?.currentDay ?? 1;
  const currentStake = progress?.currentStake ?? 10;
  const settled = progress?.settled ?? false;
  const result = progress?.result ?? null;

  // Compute target win from currentStake × combined decimal odds of today's legs
  const todayDecimal = today.legs.reduce((acc, l) => {
    return acc * (l.odds > 0 ? l.odds / 100 + 1 : 100 / Math.abs(l.odds) + 1);
  }, 1);
  const targetWin = currentStake * todayDecimal;
  const todayCombined = calcCombinedOdds(today.legs);

  // Day dots 1–10 showing streak progress
  const TOTAL_DAYS = parlay.totalDays ?? steps.length;
  const dots = Array.from({ length: TOTAL_DAYS }, (_, i) => i + 1);

  const WON_COLOR = "#22c55e";
  const LOST_COLOR = "#ef4444";

  return (
    <View style={[styles.parlayCard, { backgroundColor: colors.card, borderColor: LADDER_ACCENT + "44" }]}>
      {/* Header row */}
      <View style={styles.parlayHeader}>
        <View style={[styles.parlayBadge, { backgroundColor: LADDER_ACCENT + "22", borderColor: LADDER_ACCENT + "44", borderWidth: 1 }]}>
          <Text style={[styles.parlayBadgeText, { color: LADDER_ACCENT }]}>Daily Ladder</Text>
        </View>
        <Text style={[ladderStyles.dayLabel, { color: colors.mutedForeground }]}>
          Day {currentDay} of {TOTAL_DAYS} · ${parlay.startStake} → ${parlay.targetPayout.toLocaleString()}
        </Text>
      </View>

      {/* Streak dots */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={ladderStyles.dotTrack}>
        <View style={ladderStyles.dotRow}>
          {dots.map((d) => {
            const isPast = d < currentDay;
            const isCurrent = d === currentDay;
            const bgColor = isPast ? WON_COLOR : isCurrent ? LADDER_ACCENT : colors.border;
            const textColor = (isPast || isCurrent) ? "#fff" : colors.mutedForeground;
            return (
              <View key={d} style={ladderStyles.dotItem}>
                <View style={[ladderStyles.dot, { backgroundColor: bgColor }]}>
                  {isPast ? (
                    <Feather name="check" size={14} color="#fff" />
                  ) : (
                    <Text style={[ladderStyles.dotDay, { color: textColor }]}>{d}</Text>
                  )}
                </View>
                <Text style={[ladderStyles.dotAmount, { color: isCurrent ? LADDER_ACCENT : colors.mutedForeground }]}>
                  {isCurrent ? fmtMoney(targetWin) : ""}
                </Text>
              </View>
            );
          })}
        </View>
      </ScrollView>

      {/* Result banner — shown after settlement */}
      {settled && result === "won" && (
        <View style={[ladderStyles.resultBanner, { backgroundColor: WON_COLOR + "18", borderColor: WON_COLOR + "55" }]}>
          <Feather name="check-circle" size={16} color={WON_COLOR} />
          <Text style={[ladderStyles.resultBannerText, { color: WON_COLOR }]}>
            Won! Day {currentDay} unlocked — roll ${currentStake.toFixed(0)} tomorrow.
          </Text>
        </View>
      )}
      {settled && result === "lost" && (
        <View style={[ladderStyles.resultBanner, { backgroundColor: LOST_COLOR + "18", borderColor: LOST_COLOR + "55" }]}>
          <Feather name="x-circle" size={16} color={LOST_COLOR} />
          <Text style={[ladderStyles.resultBannerText, { color: LOST_COLOR }]}>
            Lost. Reset to Day 1 — come back tomorrow with $10.
          </Text>
        </View>
      )}

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
            <Text style={[ladderStyles.stakeValue, { color: colors.foreground }]}>${currentStake.toFixed(0)}</Text>
          </View>
          <Feather name="arrow-right" size={16} color={LADDER_ACCENT} />
          <View style={[ladderStyles.stakeBox, { backgroundColor: colors.background }]}>
            <Text style={[ladderStyles.stakeLabel, { color: colors.mutedForeground }]}>Win</Text>
            <Text style={[ladderStyles.stakeValue, { color: LADDER_ACCENT }]}>${targetWin.toFixed(0)}</Text>
          </View>
          <View style={[ladderStyles.oddsBadge, { backgroundColor: LADDER_ACCENT + "22", borderColor: LADDER_ACCENT + "55" }]}>
            <Text style={[ladderStyles.oddsBadgeText, { color: LADDER_ACCENT }]}>{fmtOdds(todayCombined)}</Text>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.actionBtnFull, { backgroundColor: LADDER_ACCENT, marginTop: 10 }]}
          onPress={() => onBet(today.legs)}
        >
          <Feather name="external-link" size={14} color="#fff" />
          <Text style={styles.betBtnText}>Place Today's 2-Leg Bet</Text>
        </TouchableOpacity>
      </View>

      {/* Settlement buttons — only shown if not yet settled today */}
      {!settled && (
        <View style={ladderStyles.settleRow}>
          <Text style={[ladderStyles.settlePrompt, { color: colors.mutedForeground }]}>Did today's bet win?</Text>
          <View style={ladderStyles.settleBtns}>
            <TouchableOpacity
              style={[ladderStyles.settleBtn, { backgroundColor: "#22c55e22", borderColor: "#22c55e66" }]}
              onPress={() => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); onSettle(true); }}
              disabled={isSettling}
            >
              <Feather name="check" size={16} color="#22c55e" />
              <Text style={[ladderStyles.settleBtnText, { color: "#22c55e" }]}>Won</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[ladderStyles.settleBtn, { backgroundColor: "#ef444422", borderColor: "#ef444466" }]}
              onPress={() => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); onSettle(false); }}
              disabled={isSettling}
            >
              <Feather name="x" size={16} color="#ef4444" />
              <Text style={[ladderStyles.settleBtnText, { color: "#ef4444" }]}>Lost</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Ladder action row */}
      <View style={[styles.parlayActions, { marginTop: 4 }]}>
        <TouchableOpacity
          style={[styles.shareBtn, { borderColor: LADDER_ACCENT + "55", flex: 1 }]}
          onPress={() => { Haptics.selectionAsync(); onLog(); }}
        >
          <Feather name="plus-circle" size={14} color={LADDER_ACCENT} />
          <Text style={[styles.shareBtnText, { color: LADDER_ACCENT }]}>Log Bet</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtnFull, { backgroundColor: LADDER_ACCENT, flex: 2 }]}
          onPress={() => onBet(today.legs)}
        >
          <Feather name="external-link" size={14} color="#fff" />
          <Text style={styles.betBtnText}>Place Bet</Text>
        </TouchableOpacity>
      </View>
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

  // All-sports data — cross-sport parlays for the All Sports tab
  const {
    data: allData,
    isLoading: allLoading,
    isFetching: allFetching,
    refetch: refetchAll,
  } = useGetAiPicks(
    undefined,
    { query: { staleTime: 15 * 60_000, gcTime: 15 * 60_000, refetchOnMount: true, refetchOnWindowFocus: false } as any },
  );

  // Sport-specific data — fetched lazily when a sport tab is active
  const {
    data: sportData,
    isLoading: sportLoading,
    isFetching: sportFetching,
    refetch: refetchSport,
  } = useGetAiPicks(
    selectedSport !== "all" ? { sport: selectedSport } : undefined,
    {
      query: {
        enabled: selectedSport !== "all",
        staleTime: 15 * 60_000,
        gcTime: 15 * 60_000,
        refetchOnMount: true,
        refetchOnWindowFocus: false,
      } as any,
    },
  );

  const isLoading = selectedSport === "all" ? allLoading : (allLoading || sportLoading);
  const isFetching = selectedSport === "all" ? allFetching : (allFetching || sportFetching);
  function refetch() { refetchAll(); if (selectedSport !== "all") refetchSport(); }

  const { mutate: doRefresh, isPending: isRefreshing } = useRefreshAiPicks();
  const queryClient = useQueryClient();

  const { data: ladderProgress, refetch: refetchProgress } = useGetLadderProgress(
    { sport: selectedSport },
    { query: { staleTime: 0, refetchOnMount: true, refetchOnWindowFocus: false } as any },
  );
  const { mutate: settleLadder, isPending: isSettling } = useSettleLadder();

  function handleSettle(won: boolean) {
    const step = activeLadder?.steps?.[0];
    if (!step) return;
    const stake = ladderProgress?.currentStake ?? 10;
    const decimal = step.legs.reduce((acc: number, l: AIPickLeg) => {
      return acc * (l.odds > 0 ? l.odds / 100 + 1 : 100 / Math.abs(l.odds) + 1);
    }, 1);
    const payout = parseFloat((stake * decimal).toFixed(2));
    settleLadder(
      { data: { sport: selectedSport, won, payout: won ? payout : 0 } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetLadderProgressQueryKey({ sport: selectedSport }) });
          refetchProgress();
        },
      },
    );
  }

  // All Sports tab uses cross-sport all* parlays; sport tabs use sport-filtered parlays
  const isAllTab = selectedSport === "all";
  const lock = isAllTab ? (allData?.lockOfTheDay ?? null) : (sportData?.lockOfTheDay ?? null);
  const safeParlay  = isAllTab ? (allData?.allSafeParlay  ?? null) : (sportData?.safeParlay          ?? null);
  const lottoParlay = isAllTab ? (allData?.allLottoParlay  ?? null) : (sportData?.lottoParlay         ?? null);
  const gameParlay  = isAllTab ? (allData?.allGameParlay   ?? null) : (sportData?.gameParlayOfTheDay  ?? null);
  const propParlay  = isAllTab ? (allData?.allPropsParlay  ?? null) : (sportData?.propParlayOfTheDay  ?? null);
  const mixParlay   = isAllTab ? (allData?.allMixParlay    ?? null) : (sportData?.mixParlayOfTheDay   ?? null);

  // Sport-specific prop parlays come from the sport tab's own response
  const hrParlay         = sportData?.hrParlay         ?? allData?.hrParlay         ?? null;
  const goalScorerParlay = sportData?.goalScorerParlay ?? allData?.goalScorerParlay ?? null;
  const threePtParlay    = sportData?.threePtParlay    ?? allData?.threePtParlay    ?? null;
  const tdParlay         = sportData?.tdParlay         ?? allData?.tdParlay         ?? null;
  const allScorerParlay  = isAllTab ? ((allData as any)?.allScorerParlay ?? null) : null;

  // Ladders — prefer sportData (sport-specific) then fall back to allData (pre-computed)
  const allLadder    = (allData?.allLadder    ?? null) as AILadderParlay | null;
  const nbaLadder    = (sportData?.nbaLadder    ?? allData?.nbaLadder    ?? null) as AILadderParlay | null;
  const mlbLadder    = (sportData?.mlbLadder    ?? allData?.mlbLadder    ?? null) as AILadderParlay | null;
  const nhlLadder    = (sportData?.nhlLadder    ?? allData?.nhlLadder    ?? null) as AILadderParlay | null;
  const nflLadder    = (sportData?.nflLadder    ?? allData?.nflLadder    ?? null) as AILadderParlay | null;
  const wnbaLadder   = ((sportData as any)?.wnbaLadder   ?? (allData as any)?.wnbaLadder   ?? null) as AILadderParlay | null;
  const soccerLadder = ((sportData as any)?.soccerLadder ?? (allData as any)?.soccerLadder ?? null) as AILadderParlay | null;
  const isAI = allData?.isAI ?? false;

  const activeLadder =
    selectedSport === "all"    ? allLadder    :
    selectedSport === "NBA"    ? nbaLadder    :
    selectedSport === "MLB"    ? mlbLadder    :
    selectedSport === "NHL"    ? nhlLadder    :
    selectedSport === "NFL"    ? nflLadder    :
    selectedSport === "WNBA"   ? wnbaLadder   :
    selectedSport === "Soccer" ? soccerLadder :
    null;

  const sportIconMap: Record<string, string> = {
    all: "🏆", NBA: "🏀", MLB: "⚾", NHL: "🏒", NFL: "🏈",
    NCAAB: "🎓", NCAAF: "🎓", WNBA: "🏀", Soccer: "⚽", MMA: "🥊", Boxing: "🥊",
  };
  const ladderSportIcon = sportIconMap[selectedSport] ?? "🏆";
  const ladderSportLabel = selectedSport === "all" ? "All Sports" : selectedSport;

  // Individual sports (no team matchups) and combat sports — hide "Game Picks Parlay"
  const INDIVIDUAL_SPORTS = new Set(["Tennis", "Golf"]);
  const COMBAT_SPORTS = new Set(["MMA", "Boxing"]);
  // Match Picks shown for MMA/Boxing (Fight Picks) and Tennis — NOT Golf
  const MATCH_PICKS_SPORTS = new Set(["MMA", "Boxing", "Tennis"]);
  const isIndividualSport = INDIVIDUAL_SPORTS.has(selectedSport) || COMBAT_SPORTS.has(selectedSport);

  // Sports where Props Parlay and Mix Parlay sections are shown.
  // All team sports included; individual sports handle their own sections.
  const TEAM_SPORTS = new Set(["all", "NBA", "MLB", "NHL", "NFL", "NCAAB", "NCAAF", "NCAABSB", "WNBA", "Soccer"]);
  const hasSportProps  = TEAM_SPORTS.has(selectedSport);
  const hasMixParlay   = TEAM_SPORTS.has(selectedSport) || MATCH_PICKS_SPORTS.has(selectedSport);
  const hasSportLadder = activeLadder !== null;

  // True when the API returned no picks for this sport (no qualifying games today).
  // Individual sports (Tennis, Golf) don't have game parlays, so don't gate on it.
  const noPicksForSport = !isAllTab && !isLoading && !lock && !safeParlay && !lottoParlay
    && (isIndividualSport || !gameParlay);

  // Build the tab list dynamically — show only sports with games today.
  // While loading, fall back to the 4 core US sports.
  const activeSports = (allData as any)?.activeSports as string[] | undefined;
  // Only team sports get dedicated tabs — MMA, Boxing, Tennis, Golf are individual/combat
  // sports covered under the All Sports aggregate, not their own tabs.
  const sportTabs = activeSports
    ? ALL_POSSIBLE_TABS.filter((t) => t.key === "all" || (activeSports.includes(t.key) && TEAM_SPORTS.has(t.key)))
    : ALL_POSSIBLE_TABS.filter((t) => ["all", "NBA", "MLB", "NHL", "NFL"].includes(t.key));

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

  function openBetParlay(legs: AIPickLeg[]) {
    if (!legs.length) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const combined = calcCombinedOdds(legs);
    const pickText = legs.map((l, i) => `Leg ${i + 1}: ${l.pick}`).join("  ·  ");
    setBookmakerBet({
      matchup: legs.length > 1 ? `${legs.length}-Leg Parlay` : `${legs[0].awayTeam} @ ${legs[0].homeTeam}`,
      pick: pickText,
      odds: combined,
      sport: legs[0].sport,
      preferredBookmaker: legs[0].bookmaker,
    });
  }

  function logParlay(p: AIParlay) {
    const legSummary = p.legs.map((l, i) =>
      `${i + 1}. ${l.player ? `${l.player} — ` : ""}${l.pick} (${fmtOdds(l.odds)})`
    ).join("  |  ");
    setQuickAdd({
      matchup: p.name,
      pick: legSummary,
      bookmaker: p.legs[0]?.bookmaker ?? "—",
      odds: p.combinedOdds,
    });
  }

  function logLadder(p: AILadderParlay) {
    const today = p.steps?.[0];
    if (!today) return;
    const legSummary = today.legs.map((l, i) =>
      `${i + 1}. ${l.pick} (${fmtOdds(l.odds)})`
    ).join("  |  ");
    const stake = ladderProgress?.currentStake ?? 10;
    setQuickAdd({
      matchup: `Daily Ladder — Day ${ladderProgress?.currentDay ?? 1}`,
      pick: legSummary,
      bookmaker: today.legs[0]?.bookmaker ?? "—",
      odds: calcCombinedOdds(today.legs),
    });
    void stake; // stake shown in modal after user enters it
  }

  // Auto-refresh banner: shown when picks were silently regenerated due to
  // a canceled game or a ruled-out player — auto-dismisses after 15s.
  const [autoRefreshedBanner, setAutoRefreshedBanner] = useState(false);
  const autoRefreshedFlag = (allData as any)?.autoRefreshed as boolean | undefined;
  useEffect(() => {
    if (!autoRefreshedFlag) return;
    setAutoRefreshedBanner(true);
    const t = setTimeout(() => setAutoRefreshedBanner(false), 15_000);
    return () => clearTimeout(t);
  }, [autoRefreshedFlag]);

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
          data={sportTabs}
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
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Auto-refresh banner — appears when picks were silently regenerated */}
        {autoRefreshedBanner && (
          <View style={{
            flexDirection: "row", alignItems: "flex-start", gap: 10,
            backgroundColor: "#f59e0b18", borderColor: "#f59e0b44",
            borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 12,
          }}>
            <Feather name="alert-triangle" size={15} color="#fbbf24" style={{ marginTop: 1 }} />
            <Text style={{ flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: "#fcd34d", lineHeight: 19 }}>
              Picks were automatically updated — a game was postponed or a player was ruled out. Fresh picks are now showing.
            </Text>
            <TouchableOpacity onPress={() => setAutoRefreshedBanner(false)} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
              <Feather name="x" size={15} color="#fbbf2488" />
            </TouchableOpacity>
          </View>
        )}

        {/* Summary banner */}
        {allData?.summary ? (
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
                {allData.generatedAt ? (
                  <Text style={{ fontSize: 11, color: colors.mutedForeground }}>
                    Updated {new Date(allData.generatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                  </Text>
                ) : null}
                <View style={{ backgroundColor: colors.primary + "22", borderColor: colors.primary + "44", borderWidth: 1, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 }}>
                  <Text style={{ fontSize: 10, fontWeight: "700", color: colors.primary }}>v3.1</Text>
                </View>
              </View>
              <Text style={[styles.summaryText, { color: colors.mutedForeground }]} numberOfLines={3}>
                {allData.summary}
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
        ) : noPicksForSport ? (
          /* ── No picks available for this sport today ── */
          <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border, marginHorizontal: 16 }]}>
            <Text style={[styles.emptyCardText, { color: colors.mutedForeground, textAlign: "center" }]}>
              No {selectedSport} picks today — either no games are on the board or market coverage is too thin.{"\n\n"}Check back later or switch to another sport.
            </Text>
          </View>
        ) : (
          <>
            {selectedSport === "NFL" && !NFL_SEASON_ACTIVE ? (
              /* ── NFL off-season: replace everything with a single message ── */
              <>
                <View style={[styles.dividerSection, { borderTopColor: colors.border }]}>
                  <Text style={[styles.dividerLabel, { color: colors.mutedForeground }]}>NFL PICKS</Text>
                </View>
                <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border, marginHorizontal: 16 }]}>
                  <Text style={[styles.emptyCardText, { color: colors.mutedForeground, textAlign: "center" }]}>
                    🏈 NFL season starts in September.{"\n"}Check back then for NFL-specific picks.
                  </Text>
                </View>
              </>
            ) : (
              <>
                {/* ── Lock of the Day ── */}
                <View style={styles.section}>
                  <SectionHeader icon="🔒" label="Lock of the Day" sublabel="Highest confidence single pick" accent="#f59e0b" />
                  {lock ? (
                    <LockCard
                      pick={lock}
                      onTrack={() => openTrack(lock)}
                      onLog={() => setQuickAdd({ matchup: `${lock.awayTeam} @ ${lock.homeTeam}`, pick: lock.pick, bookmaker: lock.bookmaker, odds: lock.odds })}
                      onBet={() => openBet({ ...lock, sport: lock.sport })}
                    />
                  ) : (
                    <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                      <Text style={[styles.emptyCardText, { color: colors.mutedForeground }]}>No lock available — pull to refresh.</Text>
                    </View>
                  )}
                </View>
              </>
            )}

            {selectedSport !== "NFL" || NFL_SEASON_ACTIVE ? (
              <>
                {/* ── Safe Parlay — hidden when null ── */}
                {(safeParlay?.legs?.length ?? 0) > 0 && (
                  <View style={styles.section}>
                    <SectionHeader icon="⚡" label="Safe Parlay of the Day" sublabel="2–3 legs, solid value (+175 to +500)" accent="#22c55e" />
                    <ParlayCard parlay={safeParlay!} accent="#22c55e"
                      onBet={(leg) => openBet({ ...leg, pick: `${safeParlay!.name} (safe parlay)`, odds: safeParlay!.combinedOdds })}
                      onLog={() => logParlay(safeParlay!)} />
                  </View>
                )}

                {/* ── Lotto Parlay — hidden when null ── */}
                {(lottoParlay?.legs?.length ?? 0) > 0 && (
                  <View style={styles.section}>
                    <SectionHeader icon="🎰" label="Lotto Parlay of the Day" sublabel="4–6 legs, big payout (+800 to +3000)" accent="#a855f7" />
                    <ParlayCard parlay={lottoParlay!} accent="#a855f7"
                      onBet={(leg) => openBet({ ...leg, pick: `${lottoParlay!.name} (lotto parlay)`, odds: lottoParlay!.combinedOdds })}
                      onLog={() => logParlay(lottoParlay!)} />
                  </View>
                )}

                {/* ── Game Picks Parlay — team sports only, hidden when null ── */}
                {!isIndividualSport && (gameParlay?.legs?.length ?? 0) > 0 && (
                  <View style={styles.section}>
                    <SectionHeader icon="🏆" label="Game Picks Parlay" sublabel="Moneyline, spread & O/U only — no props" accent="#3b82f6" />
                    <ParlayCard parlay={gameParlay!} accent="#3b82f6"
                      onBet={(leg) => openBet({ ...leg, pick: `${gameParlay!.name} (game parlay)`, odds: gameParlay!.combinedOdds })}
                      onLog={() => logParlay(gameParlay!)} />
                  </View>
                )}

                {/* ── Fight Picks Parlay — MMA and Boxing only, hidden when no data ── */}
                {COMBAT_SPORTS.has(selectedSport) && ((propParlay?.legs?.length ?? 0) > 0 || (gameParlay?.legs?.length ?? 0) > 0) && (
                  <View style={styles.section}>
                    <SectionHeader icon="🥊" label="Fight Picks Parlay" sublabel="KO, submission & decision method props" accent="#ef4444" />
                    {(propParlay?.legs?.length ?? 0) > 0
                      ? <ParlayCard parlay={propParlay!} accent="#ef4444"
                          onBet={(leg) => openBet({ ...leg, pick: `${propParlay!.name} (fight picks)`, odds: propParlay!.combinedOdds })}
                          onLog={() => logParlay(propParlay!)} />
                      : <ParlayCard parlay={gameParlay!} accent="#ef4444"
                          onBet={(leg) => openBet({ ...leg, pick: `${gameParlay!.name} (fight picks)`, odds: gameParlay!.combinedOdds })}
                          onLog={() => logParlay(gameParlay!)} />
                    }
                  </View>
                )}

                {/* ── Match Picks Parlay — Tennis only, hidden when no data ── */}
                {selectedSport === "Tennis" && (gameParlay?.legs?.length ?? 0) > 0 && (
                  <View style={styles.section}>
                    <SectionHeader icon="🎾" label="Match Picks Parlay" sublabel="Best value match picks combined" accent="#ec4899" />
                    <ParlayCard parlay={gameParlay!} accent="#ec4899"
                      onBet={(leg) => openBet({ ...leg, pick: `${gameParlay!.name} (match picks)`, odds: gameParlay!.combinedOdds })}
                      onLog={() => logParlay(gameParlay!)} />
                  </View>
                )}

                {/* ── Player Props Parlay — team sports only, hidden when null ── */}
                {hasSportProps && (propParlay?.legs?.length ?? 0) > 0 && (
                  <View style={styles.section}>
                    <SectionHeader icon="🎯"
                      label={
                        selectedSport === "Soccer" ? "Match Value Parlay" :
                        selectedSport === "WNBA" ? "WNBA Props Parlay" :
                        selectedSport === "NCAAB" ? "NCAAB Props Parlay" :
                        selectedSport === "NCAAF" ? "NCAAF Props Parlay" :
                        selectedSport === "NCAABSB" ? "NCAABSB Props Parlay" :
                        "Player Props Parlay"
                      }
                      sublabel={
                        selectedSport === "Soccer" ? "Best value soccer match picks combined" :
                        "All player performance props"
                      }
                      accent="#f97316" />
                    <ParlayCard parlay={propParlay!} accent="#f97316"
                      onBet={(leg) => openBet({ ...leg, pick: `${propParlay!.name} (props parlay)`, odds: propParlay!.combinedOdds })}
                      onLog={() => logParlay(propParlay!)} />
                  </View>
                )}

                {/* ── Mix Parlay — team sports + non-Golf individual sports, hidden when null ── */}
                {hasMixParlay && (mixParlay?.legs?.length ?? 0) > 0 && (
                  <View style={styles.section}>
                    <SectionHeader icon="🔀" label="Mix Parlay" sublabel="Game bets + player props combined" accent="#14b8a6" />
                    <ParlayCard parlay={mixParlay!} accent="#14b8a6"
                      onBet={(leg) => openBet({ ...leg, pick: `${mixParlay!.name} (mix parlay)`, odds: mixParlay!.combinedOdds })}
                      onLog={() => logParlay(mixParlay!)} />
                  </View>
                )}

                {/* ── Notice when lock exists but parlays couldn't be built ── */}
                {lock && (safeParlay?.legs?.length ?? 0) === 0 && (lottoParlay?.legs?.length ?? 0) === 0
                  && (gameParlay?.legs?.length ?? 0) === 0 && (propParlay?.legs?.length ?? 0) === 0
                  && (mixParlay?.legs?.length ?? 0) === 0 && (
                  <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border, marginHorizontal: 16 }]}>
                    <Text style={[styles.emptyCardText, { color: colors.mutedForeground }]}>
                      Not enough games on the board today for multi-leg parlays — the Lock of the Day above is your best bet. Parlays will populate as more {isAllTab ? "sports" : selectedSport} games are added.
                    </Text>
                  </View>
                )}

                {/* ── All Sports Scorer Parlay — All Sports tab only ── */}
                {isAllTab && allScorerParlay && (
                  <>
                    <View style={[styles.dividerSection, { borderTopColor: colors.border }]}>
                      <Text style={[styles.dividerLabel, { color: colors.mutedForeground }]}>ALL SPORTS SCORER</Text>
                    </View>
                    <View style={styles.section}>
                      <SectionHeader icon="🏆" label="All Sports Scorer Parlay" sublabel="HR + 3PT + TD + Goal scorer legs combined" accent="#f59e0b" />
                      <ParlayCard parlay={allScorerParlay} accent="#f59e0b"
                        onBet={(leg) => openBet({ ...leg, pick: `${allScorerParlay.name}`, odds: allScorerParlay.combinedOdds })}
                        onLog={() => logParlay(allScorerParlay)} />
                    </View>
                  </>
                )}

                {/* ── Sport-specific scorer parlays — team sports per-sport tab ── */}
                {hasSportProps && selectedSport !== "all" && (() => {
                  const has3pt = (selectedSport === "NBA" || selectedSport === "WNBA" || selectedSport === "NCAAB") && (threePtParlay?.legs?.length ?? 0) > 0;
                  const hasHr  = (selectedSport === "MLB" || selectedSport === "NCAABSB") && (hrParlay?.legs?.length ?? 0) > 0;
                  const hasGs  = (selectedSport === "NHL" || selectedSport === "Soccer") && (goalScorerParlay?.legs?.length ?? 0) > 0;
                  const hasTd  = (selectedSport === "NFL" || selectedSport === "NCAAF") && NFL_SEASON_ACTIVE && (tdParlay?.legs?.length ?? 0) > 0;
                  if (!has3pt && !hasHr && !hasGs && !hasTd) return null;
                  const scorerLabel =
                    selectedSport === "WNBA" ? "WNBA 3-Pointer Parlay" :
                    selectedSport === "NCAAB" ? "NCAAB 3-Pointer Parlay" :
                    selectedSport === "NCAABSB" ? "NCAABSB Home Run Parlay" :
                    selectedSport === "Soccer" ? "Soccer Goal Scorer Parlay" :
                    selectedSport === "NCAAF" ? "NCAAF TD Scorer Parlay" : null;
                  return (
                    <>
                      <View style={[styles.dividerSection, { borderTopColor: colors.border }]}>
                        <Text style={[styles.dividerLabel, { color: colors.mutedForeground }]}>{selectedSport} SCORER PARLAY</Text>
                      </View>
                      {has3pt && (
                        <View style={styles.section}>
                          <SectionHeader icon="🏀" label={scorerLabel ?? "3-Pointer Parlay"} sublabel="Volume shooters from deep" accent="#f97316" />
                          {(threePtParlay?.legs?.length ?? 0) > 0 ? (
                            <ParlayCard parlay={threePtParlay!} accent="#f97316"
                              onBet={(leg) => openBet({ ...leg, pick: `${threePtParlay!.name} (3PT parlay)`, odds: threePtParlay!.combinedOdds })}
                              onLog={() => logParlay(threePtParlay!)} />
                          ) : (
                            <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                              <Text style={[styles.emptyCardText, { color: colors.mutedForeground }]}>No 3PT parlay — check back on game days.</Text>
                            </View>
                          )}
                        </View>
                      )}
                      {hasHr && (
                        <View style={styles.section}>
                          <SectionHeader icon="💣" label={scorerLabel ?? "Home Run Parlay"} sublabel="Multi-HR bomber parlay · high variance" accent="#3b82f6" />
                          {(hrParlay?.legs?.length ?? 0) > 0 ? (
                            <ParlayCard parlay={hrParlay!} accent="#3b82f6"
                              onBet={(leg) => openBet({ ...leg, pick: `${hrParlay!.name} (HR parlay)`, odds: hrParlay!.combinedOdds })}
                              onLog={() => logParlay(hrParlay!)} />
                          ) : (
                            <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                              <Text style={[styles.emptyCardText, { color: colors.mutedForeground }]}>Home run props not yet posted — check back closer to first pitch.</Text>
                            </View>
                          )}
                        </View>
                      )}
                      {hasGs && (
                        <View style={styles.section}>
                          <SectionHeader icon="🏒" label={scorerLabel ?? "Goal Scorer Parlay"} sublabel="Anytime goal or assist combo" accent="#8b5cf6" />
                          {(goalScorerParlay?.legs?.length ?? 0) > 0 ? (
                            <ParlayCard parlay={goalScorerParlay!} accent="#8b5cf6"
                              onBet={(leg) => openBet({ ...leg, pick: `${goalScorerParlay!.name} (goal scorer)`, odds: goalScorerParlay!.combinedOdds })}
                              onLog={() => logParlay(goalScorerParlay!)} />
                          ) : (
                            <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                              <Text style={[styles.emptyCardText, { color: colors.mutedForeground }]}>No goal scorer parlay — check back on game days.</Text>
                            </View>
                          )}
                        </View>
                      )}
                      {hasTd && (
                        <View style={styles.section}>
                          <SectionHeader icon="🏈" label={scorerLabel ?? "TD Scorer Parlay"} sublabel="Anytime touchdown combo" accent="#22c55e" />
                          {(tdParlay?.legs?.length ?? 0) > 0 ? (
                            <ParlayCard parlay={tdParlay!} accent="#22c55e"
                              onBet={(leg) => openBet({ ...leg, pick: `${tdParlay!.name} (TD parlay)`, odds: tdParlay!.combinedOdds })}
                              onLog={() => logParlay(tdParlay!)} />
                          ) : (
                            <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                              <Text style={[styles.emptyCardText, { color: colors.mutedForeground }]}>No TD parlay — check back on game days.</Text>
                            </View>
                          )}
                        </View>
                      )}
                    </>
                  );
                })()}
              </>
            ) : null}

            {/* ── Daily Ladder — only for sports that have a ladder (NBA/MLB/NHL/NFL/All) ── */}
            {hasSportLadder && (
              <>
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
                  {(activeLadder!.steps?.length ?? 0) >= 1 ? (
                    <DailyLadderCard
                      parlay={activeLadder!}
                      progress={ladderProgress}
                      onBet={(legs) => openBetParlay(legs)}
                      onLog={() => logLadder(activeLadder!)}
                      onSettle={handleSettle}
                      isSettling={isSettling}
                    />
                  ) : (
                    <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                      <Text style={[styles.emptyCardText, { color: colors.mutedForeground }]}>
                        {selectedSport === "NFL" && !NFL_SEASON_ACTIVE
                          ? "NFL ladder available during the season (September–February)."
                          : `No ${ladderSportLabel} ladder today — pull to refresh.`}
                      </Text>
                    </View>
                  )}
                </View>
              </>
            )}
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
  parlayActions: {
    flexDirection: "row",
    gap: 8,
    marginHorizontal: 14,
    marginTop: 4,
    marginBottom: 14,
  },
  parlayShareIcon: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  shareBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 5,
  },
  shareBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
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

// ─── Lock card extra styles ───────────────────────────────────────────────────

const lockStyles = StyleSheet.create({
  edgeBadge: {
    backgroundColor: "#22c55e18",
    borderWidth: 1,
    borderColor: "#22c55e44",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginTop: 5,
    alignItems: "center",
  },
  edgeBadgeText: {
    color: "#22c55e",
    fontSize: 11,
    fontFamily: "Inter_700Bold",
  },
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

  // Result banner
  resultBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 10,
  },
  resultBannerText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    flex: 1,
  },

  // Settlement buttons
  settleRow: {
    marginTop: 14,
    gap: 8,
  },
  settlePrompt: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  settleBtns: {
    flexDirection: "row",
    gap: 10,
  },
  settleBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  settleBtnText: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
  },
});
