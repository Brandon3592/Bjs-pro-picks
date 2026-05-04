import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Linking from "expo-linking";
import React from "react";
import {
  Linking as RNLinking,
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

const SPORTSBOOKS: { name: string; url: string; color: string }[] = [
  { name: "DraftKings", url: "https://sportsbook.draftkings.com/", color: "#53D16A" },
  { name: "FanDuel", url: "https://sportsbook.fanduel.com/", color: "#1493FF" },
  { name: "BetMGM", url: "https://sports.betmgm.com/en/sports", color: "#C9A84C" },
  { name: "Caesars", url: "https://www.caesars.com/sportsbook-and-casino", color: "#003087" },
  { name: "BetRivers", url: "https://www.betrivers.com/", color: "#E4002B" },
  { name: "Bovada", url: "https://www.bovada.lv/sports", color: "#FF6900" },
  { name: "BetOnline", url: "https://www.betonline.ag/sportsbook", color: "#4CAF50" },
  { name: "PointsBet", url: "https://www.pointsbet.com/", color: "#E63946" },
];

export function getSportsbookUrl(bookmaker: string): string {
  const found = SPORTSBOOKS.find(
    (s) => s.name.toLowerCase() === bookmaker.toLowerCase()
  );
  return found?.url ?? "https://sportsbook.draftkings.com/";
}

interface BookmakerSheetProps {
  visible: boolean;
  onClose: () => void;
  bet: {
    matchup: string;
    pick: string;
    odds: number;
    preferredBookmaker?: string;
  } | null;
}

export function BookmakerSheet({ visible, onClose, bet }: BookmakerSheetProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const openSportsbook = async (url: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await RNLinking.openURL(url);
    } catch {
      // Silently fail
    }
    onClose();
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
                Choose a sportsbook to open
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
                <Text style={[styles.betPick, { color: colors.mutedForeground }]}>{bet.pick}</Text>
                <Text style={[styles.betOdds, { color: colors.primary }]}>{oddsStr}</Text>
              </View>
            </View>
          )}

          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
            Opens in your browser — navigate to the game and place your bet
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
                  onPress={() => openSportsbook(sb.url)}
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
  sheet: { width: "100%", paddingTop: 12, paddingHorizontal: 20, maxHeight: "85%" },
  sheetRounded: { borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 16 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 },
  headerLeft: { flex: 1, gap: 2 },
  title: { fontSize: 20, fontFamily: "Inter_600SemiBold" },
  subtitle: { fontSize: 13, fontFamily: "Inter_400Regular" },
  betSummary: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginBottom: 12,
    gap: 4,
  },
  betMatchup: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  betMeta: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  betPick: { fontSize: 13, fontFamily: "Inter_400Regular" },
  betOdds: { fontSize: 15, fontFamily: "Inter_700Bold" },
  sectionLabel: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 12, lineHeight: 16 },
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
