import AsyncStorage from "@react-native-async-storage/async-storage";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useEffect, useState } from "react";
import {
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

const STORAGE_KEY = "ef_local_bets";

interface LocalBet {
  id: string;
  matchup: string;
  pick: string;
  bookmaker: string;
  odds: number;
  stake: number;
  result: "win" | "loss" | "pending";
  createdAt: string;
}

export interface QuickAddBet {
  matchup: string;
  pick: string;
  bookmaker: string;
  odds: number;
}

interface Props {
  visible: boolean;
  bet: QuickAddBet | null;
  onClose: () => void;
  onAdded?: () => void;
}

export function QuickAddModal({ visible, bet, onClose, onAdded }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [stake, setStake] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (visible) {
      setStake("");
      setDone(false);
    }
  }, [visible]);

  const isValid = !!stake && parseFloat(stake) > 0;

  const handleAdd = async () => {
    if (!isValid || !bet) return;
    setSaving(true);
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const bets: LocalBet[] = raw ? JSON.parse(raw) : [];
      const newBet: LocalBet = {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 6),
        matchup: bet.matchup,
        pick: bet.pick,
        bookmaker: bet.bookmaker || "Unknown",
        odds: bet.odds,
        stake: parseFloat(stake),
        result: "pending",
        createdAt: new Date().toISOString(),
      };
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([newBet, ...bets]));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setDone(true);
      setTimeout(() => {
        onAdded?.();
        onClose();
      }, 600);
    } catch {
      setSaving(false);
    }
  };

  const odds = bet?.odds ?? 0;
  const oddsStr = odds > 0 ? `+${odds}` : `${odds}`;
  const impliedPct = odds > 0
    ? (100 / (odds + 100) * 100).toFixed(0)
    : (Math.abs(odds) / (Math.abs(odds) + 100) * 100).toFixed(0);
  const stakeNum = parseFloat(stake) || 0;
  const potentialWin = stakeNum > 0
    ? odds > 0
      ? (stakeNum * odds / 100).toFixed(2)
      : (stakeNum * 100 / Math.abs(odds)).toFixed(2)
    : null;

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
          Platform.OS !== "ios" && styles.wrapperOverlay,
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
          {/* Handle */}
          <View style={[styles.handle, { backgroundColor: colors.border }]} />

          {/* Header */}
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.foreground }]}>Track this Bet</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}>
              <Feather name="x" size={22} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>

          {/* Bet summary card */}
          <View style={[styles.summary, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.summaryMatchup, { color: colors.foreground }]} numberOfLines={2}>
              {bet?.matchup}
            </Text>
            <Text style={[styles.summaryPick, { color: colors.mutedForeground }]} numberOfLines={1}>
              {bet?.pick}
            </Text>
            <View style={styles.summaryMeta}>
              <Text style={[styles.summaryBook, { color: colors.mutedForeground }]}>
                {bet?.bookmaker}
              </Text>
              <View style={styles.summaryRight}>
                <Text style={[styles.summaryOdds, { color: colors.primary }]}>{oddsStr}</Text>
                <Text style={[styles.summaryImplied, { color: colors.mutedForeground }]}>
                  {impliedPct}% implied
                </Text>
              </View>
            </View>
          </View>

          {/* Stake input */}
          <View style={styles.stakeSection}>
            <Text style={[styles.stakeLabel, { color: colors.mutedForeground }]}>
              How much are you betting?
            </Text>
            <View style={[styles.stakeRow, { backgroundColor: colors.muted, borderColor: isValid ? colors.primary : colors.border }]}>
              <Text style={[styles.currency, { color: colors.mutedForeground }]}>$</Text>
              <TextInput
                style={[styles.stakeInput, { color: colors.foreground }]}
                value={stake}
                onChangeText={setStake}
                placeholder="0.00"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="decimal-pad"
                autoFocus
                selectTextOnFocus
              />
            </View>
            {potentialWin && (
              <Text style={[styles.potentialWin, { color: colors.positive }]}>
                Potential win: +${potentialWin}
              </Text>
            )}
          </View>

          {/* Action buttons */}
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.cancelBtn, { borderColor: colors.border }]}
              onPress={onClose}
              activeOpacity={0.7}
            >
              <Text style={[styles.cancelText, { color: colors.foreground }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.addBtn,
                { backgroundColor: done ? colors.positive : colors.primary },
                !isValid && styles.disabled,
              ]}
              onPress={handleAdd}
              disabled={!isValid || saving || done}
              activeOpacity={0.85}
            >
              {done ? (
                <Feather name="check" size={20} color="#fff" />
              ) : (
                <Text style={[styles.addText, { color: colors.primaryForeground }]}>Add to Tracker</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1, justifyContent: "flex-end" },
  wrapperOverlay: { justifyContent: "flex-end" },
  sheet: { width: "100%", paddingTop: 12, paddingHorizontal: 20 },
  sheetRounded: { borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 16,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  title: { fontSize: 20, fontFamily: "Inter_600SemiBold" },
  summary: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    gap: 4,
    marginBottom: 20,
  },
  summaryMatchup: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  summaryPick: { fontSize: 13, fontFamily: "Inter_400Regular" },
  summaryMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 4,
  },
  summaryBook: { fontSize: 12, fontFamily: "Inter_400Regular" },
  summaryRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  summaryOdds: { fontSize: 15, fontFamily: "Inter_700Bold" },
  summaryImplied: { fontSize: 11, fontFamily: "Inter_400Regular" },
  stakeSection: { marginBottom: 20, gap: 8 },
  stakeLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  stakeRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
  },
  currency: { fontSize: 18, fontFamily: "Inter_500Medium" },
  stakeInput: { flex: 1, fontSize: 22, fontFamily: "Inter_700Bold" },
  potentialWin: { fontSize: 13, fontFamily: "Inter_500Medium" },
  actions: { flexDirection: "row", gap: 10 },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
  },
  cancelText: { fontSize: 15, fontFamily: "Inter_500Medium" },
  addBtn: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  addText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  disabled: { opacity: 0.45 },
});
