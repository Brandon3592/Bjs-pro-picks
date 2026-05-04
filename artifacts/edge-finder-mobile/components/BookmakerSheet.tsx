import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import React, { useEffect, useState } from "react";
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
    name: "William Hill",
    color: "#00A6E2",
    getUrl: (sport) => {
      const paths: Record<string, string> = {
        NBA: "https://www.williamhill.com/us/nj/bet/basketball/nba",
        NFL: "https://www.williamhill.com/us/nj/bet/football/nfl",
        MLB: "https://www.williamhill.com/us/nj/bet/baseball/mlb",
        NHL: "https://www.williamhill.com/us/nj/bet/hockey/nhl",
      };
      return paths[sport ?? ""] ?? "https://www.williamhill.com/us/nj/bet";
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

  const oddsStr = bet ? (bet.odds > 0 ? `+${bet.odds}` : `${bet.odds}`) : "";
  const pickText = bet ? `${bet.matchup} — ${bet.pick} (${oddsStr})` : "";

  // Auto-copy pick to clipboard whenever sheet opens
  useEffect(() => {
    if (visible && bet) {
      Clipboard.setStringAsync(pickText).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 3000);
      });
    }
  }, [visible, pickText]);

  const openSportsbook = (sb: Sportsbook) => {
    const url = sb.getUrl(bet?.sport);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (Platform.OS === "web") {
      window.open(url, "_blank", "noopener,noreferrer");
    } else {
      Linking.openURL(url).catch(() => {});
    }
    onClose();
  };

  // Sort: preferred bookmaker goes first
  const sortedBooks = [...SPORTSBOOKS].sort((a, b) => {
    const pref = bet?.preferredBookmaker?.toLowerCase() ?? "";
    const aMatch = a.name.toLowerCase() === pref ? -1 : 0;
    const bMatch = b.name.toLowerCase() === pref ? 1 : 0;
    return aMatch + bMatch;
  });

  const preferredBook = sortedBooks[0];
  const otherBooks = sortedBooks.slice(1);

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
                Pick is copied — just open your book and search
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
                <Text style={[styles.betPick, { color: colors.foreground, flex: 1 }]}>
                  {bet.pick}
                </Text>
                <Text style={[styles.betOdds, { color: colors.primary }]}>{oddsStr}</Text>
              </View>

              <View style={[styles.copiedBanner, {
                backgroundColor: copied ? colors.primary + "15" : colors.muted,
                borderColor: copied ? colors.primary + "44" : colors.border,
              }]}>
                <Feather
                  name={copied ? "check-circle" : "copy"}
                  size={14}
                  color={copied ? colors.primary : colors.mutedForeground}
                />
                <Text style={[styles.copiedText, { color: copied ? colors.primary : colors.mutedForeground }]}>
                  {copied ? "Pick copied to clipboard!" : "Copying pick…"}
                </Text>
              </View>
            </View>
          )}

          {/* Preferred sportsbook — big CTA */}
          {preferredBook && (
            <>
              <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
                Best odds found at
              </Text>
              <TouchableOpacity
                style={[styles.primaryBookBtn, { backgroundColor: preferredBook.color }]}
                onPress={() => openSportsbook(preferredBook)}
                activeOpacity={0.82}
              >
                <View style={styles.primaryBookLeft}>
                  <View style={[styles.bookDotLg, { backgroundColor: "rgba(255,255,255,0.35)" }]} />
                  <Text style={styles.primaryBookName}>{preferredBook.name}</Text>
                </View>
                <View style={styles.primaryBookRight}>
                  <Text style={styles.primaryBookAction}>Open & Bet</Text>
                  <Feather name="external-link" size={16} color="#fff" />
                </View>
              </TouchableOpacity>
            </>
          )}

          <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginTop: 14 }]}>
            Or choose another sportsbook
          </Text>

          <ScrollView contentContainerStyle={styles.bookList} showsVerticalScrollIndicator={false}>
            {otherBooks.map((sb) => (
              <TouchableOpacity
                key={sb.name}
                style={[styles.bookRow, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={() => openSportsbook(sb)}
                activeOpacity={0.75}
              >
                <View style={[styles.bookDot, { backgroundColor: sb.color }]} />
                <Text style={[styles.bookName, { color: colors.foreground }]}>{sb.name}</Text>
                <Feather name="external-link" size={16} color={colors.mutedForeground} style={styles.bookArrow} />
              </TouchableOpacity>
            ))}
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
  betMeta: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8 },
  betPick: { fontSize: 14, fontFamily: "Inter_500Medium", lineHeight: 20 },
  betOdds: { fontSize: 18, fontFamily: "Inter_700Bold" },
  copiedBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 2,
  },
  copiedText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  sectionLabel: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 8 },
  primaryBookBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderRadius: 12,
    marginBottom: 4,
  },
  primaryBookLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  primaryBookRight: { flexDirection: "row", alignItems: "center", gap: 6 },
  bookDotLg: { width: 12, height: 12, borderRadius: 6 },
  primaryBookName: { fontSize: 17, fontFamily: "Inter_700Bold", color: "#fff" },
  primaryBookAction: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
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
  bookArrow: { marginLeft: 4 },
});
