import AsyncStorage from "@react-native-async-storage/async-storage";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { EmptyState } from "@/components/EmptyState";
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

function calcProfit(bet: LocalBet) {
  if (bet.result === "pending") return null;
  if (bet.result === "loss") return -bet.stake;
  const dec = bet.odds > 0 ? bet.odds / 100 + 1 : 100 / Math.abs(bet.odds) + 1;
  return bet.stake * (dec - 1);
}

function formatOdds(odds: number) {
  return odds > 0 ? `+${odds}` : `${odds}`;
}

function StatBox({ label, value, accent, negative }: { label: string; value: string; accent?: boolean; negative?: boolean }) {
  const colors = useColors();
  return (
    <View style={[styles.statBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.statValue, { color: negative ? colors.negative : accent ? colors.positive : colors.foreground }]}>
        {value}
      </Text>
      <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

export default function TrackerScreen() {
  const colors = useColors();
  const isWeb = Platform.OS === "web";
  const [bets, setBets] = useState<LocalBet[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  const [form, setForm] = useState({
    matchup: "",
    pick: "",
    bookmaker: "",
    odds: "",
    stake: "",
  });

  const load = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      setBets(raw ? JSON.parse(raw) : []);
    } catch {
      setBets([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async (updated: LocalBet[]) => {
    setBets(updated);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  };

  const addBet = async () => {
    if (!form.matchup || !form.pick || !form.odds || !form.stake) return;
    const bet: LocalBet = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 6),
      matchup: form.matchup,
      pick: form.pick,
      bookmaker: form.bookmaker || "Unknown",
      odds: parseInt(form.odds, 10),
      stake: parseFloat(form.stake),
      result: "pending",
      createdAt: new Date().toISOString(),
    };
    await save([bet, ...bets]);
    setForm({ matchup: "", pick: "", bookmaker: "", odds: "", stake: "" });
    setShowModal(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const setResult = async (id: string, result: "win" | "loss" | "pending") => {
    const updated = bets.map((b) => b.id === id ? { ...b, result } : b);
    await save(updated);
    Haptics.selectionAsync();
  };

  const deleteBet = async (id: string) => {
    const updated = bets.filter((b) => b.id !== id);
    await save(updated);
  };

  const totalStaked = bets.reduce((s, b) => s + b.stake, 0);
  const totalProfit = bets.reduce((s, b) => {
    const p = calcProfit(b);
    return s + (p ?? 0);
  }, 0);
  const wins = bets.filter((b) => b.result === "win").length;
  const losses = bets.filter((b) => b.result === "loss").length;
  const settled = wins + losses;
  const winRate = settled > 0 ? ((wins / settled) * 100).toFixed(0) : "—";
  const roi = totalStaked > 0 ? ((totalProfit / totalStaked) * 100).toFixed(1) : "0.0";

  return (
    <View style={[styles.root, { backgroundColor: colors.background }, isWeb && styles.webRoot]}>
      {loading ? (
        <View style={styles.loader}><ActivityIndicator color={colors.primary} size="large" /></View>
      ) : (
        <>
          {/* Stats */}
          <View style={styles.statsRow}>
            <StatBox label="Bets" value={`${bets.length}`} />
            <StatBox label="Win Rate" value={`${winRate}%`} accent={wins > losses} />
            <StatBox label="ROI" value={`${totalProfit >= 0 ? "+" : ""}${roi}%`} accent={totalProfit > 0} negative={totalProfit < 0} />
            <StatBox label="P&L" value={`${totalProfit >= 0 ? "+$" : "-$"}${Math.abs(totalProfit).toFixed(0)}`} accent={totalProfit > 0} negative={totalProfit < 0} />
          </View>

          {!bets.length ? (
            <EmptyState
              icon="clipboard"
              title="No bets logged yet"
              subtitle="Track your bets to measure performance and ROI over time."
              actionLabel="Log a Bet"
              onAction={() => setShowModal(true)}
            />
          ) : (
            <FlatList
              data={bets}
              keyExtractor={(b) => b.id}
              contentContainerStyle={styles.list}
              scrollEnabled={!!bets.length}
              renderItem={({ item }) => {
                const profit = calcProfit(item);
                return (
                  <View style={[styles.betCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <View style={styles.betHeader}>
                      <View style={styles.betLeft}>
                        <Text style={[styles.betMatchup, { color: colors.foreground }]}>{item.matchup}</Text>
                        <Text style={[styles.betPick, { color: colors.mutedForeground }]}>
                          {item.pick} · {item.bookmaker} · {formatOdds(item.odds)}
                        </Text>
                      </View>
                      <View style={styles.betRight}>
                        <Text style={[styles.betStake, { color: colors.foreground }]}>${item.stake.toFixed(0)}</Text>
                        {profit !== null && (
                          <Text style={[styles.betProfit, { color: profit >= 0 ? colors.positive : colors.negative }]}>
                            {profit >= 0 ? "+$" : "-$"}{Math.abs(profit).toFixed(2)}
                          </Text>
                        )}
                      </View>
                    </View>
                    <View style={[styles.betActions, { borderTopColor: colors.border }]}>
                      {(["win", "loss", "pending"] as const).map((r) => (
                        <TouchableOpacity
                          key={r}
                          style={[
                            styles.resultBtn,
                            item.result === r && {
                              backgroundColor:
                                r === "win" ? colors.positive + "20"
                                  : r === "loss" ? colors.negative + "20"
                                    : colors.muted,
                              borderColor:
                                r === "win" ? colors.positive
                                  : r === "loss" ? colors.negative
                                    : colors.border,
                            },
                            item.result !== r && { borderColor: colors.border },
                          ]}
                          onPress={() => setResult(item.id, r)}
                          activeOpacity={0.7}
                        >
                          <Text style={[
                            styles.resultText,
                            { color: item.result === r
                                ? r === "win" ? colors.positive
                                  : r === "loss" ? colors.negative
                                    : colors.foreground
                                : colors.mutedForeground
                            },
                          ]}>
                            {r.charAt(0).toUpperCase() + r.slice(1)}
                          </Text>
                        </TouchableOpacity>
                      ))}
                      <TouchableOpacity style={styles.deleteBtn} onPress={() => deleteBet(item.id)} activeOpacity={0.7}>
                        <Feather name="trash-2" size={14} color={colors.negative} />
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              }}
            />
          )}

          {/* FAB */}
          {bets.length > 0 && (
            <TouchableOpacity
              style={[styles.fab, { backgroundColor: colors.primary }]}
              onPress={() => setShowModal(true)}
              activeOpacity={0.85}
            >
              <Feather name="plus" size={24} color={colors.primaryForeground} />
            </TouchableOpacity>
          )}
        </>
      )}

      {/* Add Bet Modal */}
      <Modal visible={showModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowModal(false)}>
        <View style={[styles.modal, { backgroundColor: colors.background }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Log a Bet</Text>
            <TouchableOpacity onPress={() => setShowModal(false)}>
              <Feather name="x" size={22} color={colors.foreground} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalBody}>
            {[
              { key: "matchup", label: "Matchup", placeholder: "e.g. Lakers vs Celtics" },
              { key: "pick", label: "Your Pick", placeholder: "e.g. Lakers ML" },
              { key: "bookmaker", label: "Bookmaker", placeholder: "e.g. DraftKings" },
              { key: "odds", label: "American Odds", placeholder: "e.g. -110 or +150", numeric: true },
              { key: "stake", label: "Stake ($)", placeholder: "e.g. 100", numeric: true },
            ].map(({ key, label, placeholder, numeric }) => (
              <View key={key} style={styles.field}>
                <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{label}</Text>
                <TextInput
                  style={[styles.fieldInput, { backgroundColor: colors.muted, color: colors.foreground, borderColor: colors.border }]}
                  value={form[key as keyof typeof form]}
                  onChangeText={(v) => setForm((f) => ({ ...f, [key]: v }))}
                  placeholder={placeholder}
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType={numeric ? "numbers-and-punctuation" : "default"}
                />
              </View>
            ))}
            <TouchableOpacity
              style={[styles.submitBtn, { backgroundColor: colors.primary, opacity: (!form.matchup || !form.pick || !form.odds || !form.stake) ? 0.5 : 1 }]}
              onPress={addBet}
              disabled={!form.matchup || !form.pick || !form.odds || !form.stake}
              activeOpacity={0.8}
            >
              <Text style={[styles.submitText, { color: colors.primaryForeground }]}>Add Bet</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  webRoot: { paddingTop: 67 },
  loader: { flex: 1, alignItems: "center", justifyContent: "center" },
  statsRow: { flexDirection: "row", gap: 8, padding: 16 },
  statBox: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 12,
    alignItems: "center",
    gap: 2,
  },
  statValue: { fontSize: 16, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 10, fontFamily: "Inter_400Regular" },
  list: { paddingBottom: 100 },
  betCard: {
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
  },
  betHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    padding: 14,
    paddingBottom: 10,
  },
  betLeft: { flex: 1 },
  betMatchup: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  betPick: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  betRight: { alignItems: "flex-end" },
  betStake: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  betProfit: { fontSize: 12, fontFamily: "Inter_600SemiBold", marginTop: 2 },
  betActions: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: 10,
    gap: 6,
  },
  resultBtn: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: "center",
  },
  resultText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  deleteBtn: {
    width: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  fab: {
    position: "absolute",
    bottom: 100,
    right: 20,
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  modal: { flex: 1 },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 20,
    paddingTop: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  modalBody: { padding: 20, gap: 16, paddingBottom: 60 },
  field: { gap: 6 },
  fieldLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  fieldInput: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  submitBtn: {
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 8,
  },
  submitText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
});
