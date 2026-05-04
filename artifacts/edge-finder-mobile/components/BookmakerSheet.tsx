import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import React, { useState } from "react";
import {
  Linking,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

type SportKey = "NBA" | "NFL" | "MLB" | "NHL" | string;

interface Sportsbook {
  name: string;
  color: string;
  getUrl: (sport?: SportKey) => string;
}

const SPORTSBOOKS: Sportsbook[] = [
  {
    name: "DraftKings",
    color: "#53D16A",
    getUrl: (sport) => {
      const paths: Record<string, string> = {
        NBA: "https://sportsbook.draftkings.com/leagues/basketball/nba",
        NFL: "https://sportsbook.draftkings.com/leagues/football/nfl",
        MLB: "https://sportsbook.draftkings.com/leagues/baseball/mlb",
        NHL: "https://sportsbook.draftkings.com/leagues/hockey/nhl",
      };
      return paths[sport ?? ""] ?? "https://sportsbook.draftkings.com/";
    },
  },
  {
    name: "FanDuel",
    color: "#1493FF",
    getUrl: (sport) => {
      const paths: Record<string, string> = {
        NBA: "https://sportsbook.fanduel.com/basketball/nba",
        NFL: "https://sportsbook.fanduel.com/football/nfl",
        MLB: "https://sportsbook.fanduel.com/baseball/mlb",
        NHL: "https://sportsbook.fanduel.com/hockey/nhl",
      };
      return paths[sport ?? ""] ?? "https://sportsbook.fanduel.com/";
    },
  },
  {
    name: "BetMGM",
    color: "#C9A84C",
    getUrl: (sport) => {
      const paths: Record<string, string> = {
        NBA: "https://sports.betmgm.com/en/sports/basketball-7/betting/usa-9/nba-6004",
        NFL: "https://sports.betmgm.com/en/sports/football-11/betting/usa-9/nfl-35",
        MLB: "https://sports.betmgm.com/en/sports/baseball-23/betting/usa-9/mlb-75",
        NHL: "https://sports.betmgm.com/en/sports/hockey-12/betting/usa-9/nhl-41",
      };
      return paths[sport ?? ""] ?? "https://sports.betmgm.com/en/sports";
    },
  },
  {
    name: "Caesars",
    color: "#003087",
    getUrl: (sport) => {
      const paths: Record<string, string> = {
        NBA: "https://www.caesars.com/sportsbook-and-casino/sport/basketball",
        NFL: "https://www.caesars.com/sportsbook-and-casino/sport/football",
        MLB: "https://www.caesars.com/sportsbook-and-casino/sport/baseball",
        NHL: "https://www.caesars.com/sportsbook-and-casino/sport/hockey",
      };
      return paths[sport ?? ""] ?? "https://www.caesars.com/sportsbook-and-casino";
    },
  },
  {
    name: "BetRivers",
    color: "#E4002B",
    getUrl: () => "https://www.betrivers.com/",
  },
  {
    name: "Bovada",
    color: "#FF6900",
    getUrl: (sport) => {
      const paths: Record<string, string> = {
        NBA: "https://www.bovada.lv/sports/basketball/nba",
        NFL: "https://www.bovada.lv/sports/football/nfl",
        MLB: "https://www.bovada.lv/sports/baseball/mlb",
        NHL: "https://www.bovada.lv/sports/hockey/nhl",
      };
      return paths[sport ?? ""] ?? "https://www.bovada.lv/sports";
    },
  },
  {
    name: "BetOnline",
    color: "#4CAF50",
    getUrl: () => "https://www.betonline.ag/sportsbook",
  },
];

export function getSportsbookUrl(bookmaker: string, sport?: SportKey): string {
  const found = SPORTSBOOKS.find(
    (s) => s.name.toLowerCase() === bookmaker.toLowerCase()
  );
  return found ? found.getUrl(sport) : "https://sportsbook.draftkings.com/";
}

interface BookmakerSheetProps {
  visible: boolean;
  onClose: () => void;
  bet: {
    matchup: string;
    pick: string;
    odds: number;
    sport?: SportKey;
    preferredBookmaker?: string;
  } | null;
}

export function BookmakerSheet({ visible, onClose, bet }: BookmakerSheetProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [copied, setCopied] = useState(false);

  const openSportsbook = async (sb: Sportsbook) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const url = sb.getUrl(bet?.sport);
    try {
      await Linking.openURL(url);
    } catch {
      // no-op
    }
    onClose();
  };

  const copyPick = async () => {
    if (!bet) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const oddsStr = bet.odds > 0 ? `+${bet.odds}` : `${bet.odds}`;
    const text = `${bet.matchup} — ${bet.pick} (${oddsStr})`;
    await Clipboard.setStringAsync(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const oddsStr = bet ? (bet.odds > 0 ? `+${bet.odds}` : `${bet.odds}`) : "";

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={Platform.OS === "ios" ? "pageSheet" : "overFullScreen"}
      onRequestClose={onClose}
      transparent={Platform.OS !== "ios"}
    >
      <View
        style={[
          styles.wrapper,
          Platform.OS !== "ios" && { backgroundColor: "rgba(0,0,0,0.55)" },
        ]}
      >
        <View
          style={[
            styles.sheet,
            { backgroundColor: colors.background },
            Platform.OS !== "ios" && styles.sheetRounded,
            { paddingBottom: Math.max(insets.bottom + 16, 32) },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: colors.border }]} />

          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Text style={[styles.title, { color: colors.foreground }]}>Place Your Bet</Text>
              <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
                Opens the sportsbook — search for this bet inside the app
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}>
              <Feather name="x" size={22} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>

          {bet && (
            <View style={[styles.betSummary, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.betMatchup, { color: colors.foreground }]} numberOfLines={1}>
                {bet.matchup}
              </Text>
              <View style={styles.betMeta}>
                <Text style={[styles.betPick, { color: colors.foreground, flex: 1 }]} numberOfLines={1}>
                  {bet.pick}
                </Text>
                <Text style={[styles.betOdds, { color: colors.primary }]}>{oddsStr}</Text>
              </View>

              <TouchableOpacity
                style={[styles.copyBtn, { borderColor: colors.border, backgroundColor: copied ? colors.primary + "15" : colors.muted }]}
                onPress={copyPick}
                activeOpacity={0.75}
              >
                <Feather
                  name={copied ? "check" : "copy"}
                  size={14}
                  color={copied ? colors.primary : colors.mutedForeground}
                />
                <Text style={[styles.copyBtnText, { color: copied ? colors.primary : colors.mutedForeground }]}>
                  {copied ? "Copied to clipboard!" : "Copy pick to search in app"}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
            Choose sportsbook — goes to the {bet?.sport ?? "sport"} section
          </Text>

          <ScrollView contentContainerStyle={styles.bookList} showsVerticalScrollIndicator={false}>
            {SPORTSBOOKS.map((sb) => {
              const isPreferred =
                bet?.preferredBookmaker &&
                sb.name.toLowerCase() === bet.preferredBookmaker.toLowerCase();
              return (
                <TouchableOpacity
                  key={sb.name}
                  style={[
                    styles.bookRow,
                    {
                      backgroundColor: isPreferred ? colors.primary + "15" : colors.card,
                      borderColor: isPreferred ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => openSportsbook(sb)}
                  activeOpacity={0.75}
                >
                  <View style={[styles.bookDot, { backgroundColor: sb.color }]} />
                  <Text style={[styles.bookName, { color: colors.foreground }]}>{sb.name}</Text>
                  {isPreferred && (
                    <View style={[styles.bestOddsBadge, { backgroundColor: colors.primary }]}>
                      <Text style={styles.bestOddsText}>Best Odds</Text>
                    </View>
                  )}
                  <Feather name="external-link" size={16} color={colors.mutedForeground} style={styles.bookArrow} />
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1, justifyContent: "flex-end" },
  sheet: { width: "100%", paddingTop: 12, paddingHorizontal: 20, maxHeight: "90%" },
  sheetRounded: { borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 16 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 },
  headerLeft: { flex: 1, gap: 2 },
  title: { fontSize: 20, fontFamily: "Inter_600SemiBold" },
  subtitle: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  betSummary: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginBottom: 12,
    gap: 6,
  },
  betMatchup: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  betMeta: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  betPick: { fontSize: 13, fontFamily: "Inter_400Regular" },
  betOdds: { fontSize: 16, fontFamily: "Inter_700Bold" },
  copyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 2,
  },
  copyBtnText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  sectionLabel: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 10 },
  bookList: { gap: 8, paddingBottom: 8 },
  bookRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    gap: 10,
  },
  bookDot: { width: 10, height: 10, borderRadius: 5 },
  bookName: { fontSize: 15, fontFamily: "Inter_500Medium", flex: 1 },
  bestOddsBadge: { borderRadius: 4, paddingHorizontal: 7, paddingVertical: 2 },
  bestOddsText: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#fff" },
  bookArrow: { marginLeft: 4 },
});
