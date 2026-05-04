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

function StatCard({
  label,
  value,
  color,
  icon,
}: {
  label: string;
  value: string;
  color?: string;
  icon: React.ComponentProps<typeof Feather>["name"];
}) {
  const colors = useColors();
  const fg = color ?? colors.foreground;
  return (
    <View style={[statStyles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[statStyles.iconWrap, { backgroundColor: fg + "18" }]}>
        <Feather name={icon} size={14} color={fg} />
      </View>
      <Text style={[statStyles.value, { color: fg }]}>{value}</Text>
      <Text style={[statStyles.label, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

const statStyles = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 10,
    alignItems: "center",
    gap: 4,
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  value: { fontSize: 18, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  label: { fontSize: 10, fontFamily: "Inter_500Medium", textAlign: "center" },
});

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

  const isFormValid = !!(form.matchup && form.pick && form.odds && form.stake);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }, isWeb && styles.webRoot]}>
      {loading ? (
        <View style={styles.loader}><ActivityIndicator color={colors.primary} size="large" /></View>
      ) : (
        <>
          {/* Stats grid */}
          <View style={styles.statsGrid}>
            <StatCard label="Total Bets" value={`${bets.length}`} icon="list" />
            <StatCard
              label="Win Rate"
              value={`${winRate}%`}
              icon="percent"
              color={wins >= losses && settled > 0 ? colors.positive : undefined}
            />
            <StatCard
              label="ROI"
              value={`${totalProfit >= 0 ? "+" : ""}${roi}%`}
              icon="trending-up"
              color={totalProfit > 0 ? colors.positive : totalProfit < 0 ? colors.negative : undefined}
            />
            <StatCard
              label="P&L"
              value={`${totalProfit >= 0 ? "+$" : "-$"}${Math.abs(totalProfit).toFixed(0)}`}
              icon="dollar-sign"
              color={totalProfit > 0 ? colors.positive : totalProfit < 0 ? colors.negative : undefined}
            />
          </View>

          {!bets.length ? (
            <EmptyState
              icon="trending-up"
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
              scrollEnabled
              renderItem={({ item }) => {
                const profit = calcProfit(item);
                const resultColor =
                  item.result === "win" ? colors.positive :
                  item.result === "loss" ? colors.negative :
                  colors.mutedForeground;
                return (
                  <View style={[styles.betCard, {
                    backgroundColor: colors.card,
                    borderColor: item.result === "win" ? colors.positive + "40" :
                      item.result === "loss" ? colors.negative + "30" : colors.border,
                  }]}>
                    <View style={[styles.betAccent, {
                      backgroundColor: item.result === "win" ? colors.positive :
                        item.result === "loss" ? colors.negative : colors.border,
                    }]} />
                    <View style={styles.betInner}>
                      <View style={styles.betHeader}>
                        <View style={styles.betLeft}>
                          <Text style={[styles.betMatchup, { color: colors.foreground }]}>{item.matchup}</Text>
                          <Text style={[styles.betPick, { color: colors.mutedForeground }]}>
                            {item.pick}
                          </Text>
                          <Text style={[styles.betMeta, { color: colors.mutedForeground }]}>
                            {item.bookmaker} · {formatOdds(item.odds)}
                          </Text>
                        </View>
                        <View style={styles.betRight}>
                          <Text style={[styles.betStake, { color: colors.foreground }]}>
                            ${item.stake.toFixed(0)}
                          </Text>
                          {profit !== null && (
                            <Text style={[styles.betProfit, { color: profit >= 0 ? colors.positive : colors.negative }]}>
                              {profit >= 0 ? "+$" : "-$"}{Math.abs(profit).toFixed(2)}
                            </Text>
                          )}
                        </View>
                      </View>

                      <View style={[styles.betActions, { borderTopColor: colors.border }]}>
                        {(["win", "loss", "pending"] as const).map((r) => {
                          const active = item.result === r;
                          const rColor = r === "win" ? colors.positive : r === "loss" ? colors.negative : colors.mutedForeground;
                          return (
                            <TouchableOpacity
                              key={r}
                              style={[
                                styles.resultBtn,
                                {
                                  backgroundColor: active ? rColor + "20" : "transparent",
                                  borderColor: active ? rColor + "60" : colors.border,
                                },
                              ]}
                              onPress={() => setResult(item.id, r)}
                              activeOpacity={0.7}
                            >
                              <Text style={[styles.resultText, { color: active ? rColor : colors.mutedForeground }]}>
                                {r.charAt(0).toUpperCase() + r.slice(1)}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                        <TouchableOpacity
                          style={styles.deleteBtn}
                          onPress={() => deleteBet(item.id)}
                          activeOpacity={0.7}
                        >
                          <Feather name="trash-2" size={13} color={colors.negative + "90"} />
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                );
              }}
            />
          )}

          {bets.length > 0 && (
            <TouchableOpacity
              style={[styles.fab, { backgroundColor: colors.primary }]}
              onPress={() => setShowModal(true)}
              activeOpacity={0.85}
            >
              <Feather name="plus" size={22} color={colors.primaryForeground} />
            </TouchableOpacity>
          )}
        </>
      )}

      {/* Add Bet Modal */}
      <Modal
        visible={showModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowModal(false)}
      >
        <View style={[styles.modal, { backgroundColor: colors.background }]}>
          <View style={[styles.modalHandle, { backgroundColor: colors.border }]} />
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Log a Bet</Text>
            <TouchableOpacity
              onPress={() => setShowModal(false)}
              hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
            >
              <Feather name="x" size={22} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled">
            {[
              { key: "matchup", label: "Matchup", placeholder: "e.g. Lakers vs Celtics", icon: "users" },
              { key: "pick", label: "Your Pick", placeholder: "e.g. Lakers ML", icon: "check-square" },
              { key: "bookmaker", label: "Bookmaker", placeholder: "e.g. DraftKings", icon: "book" },
              { key: "odds", label: "American Odds", placeholder: "e.g. -110 or +150", icon: "hash", numeric: true },
              { key: "stake", label: "Stake ($)", placeholder: "e.g. 100", icon: "dollar-sign", numeric: true },
            ].map(({ key, label, placeholder, numeric, icon }) => (
              <View key={key} style={styles.field}>
                <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{label}</Text>
                <View style={[styles.fieldRow, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                  <Feather name={icon as any} size={15} color={colors.mutedForeground} style={{ marginLeft: 12 }} />
                  <TextInput
                    style={[styles.fieldInput, { color: colors.foreground }]}
                    value={form[key as keyof typeof form]}
                    onChangeText={(v) => setForm((f) => ({ ...f, [key]: v }))}
                    placeholder={placeholder}
                    placeholderTextColor={colors.mutedForeground}
                    keyboardType={numeric ? "numbers-and-punctuation" : "default"}
                  />
                </View>
              </View>
            ))}
            <TouchableOpacity
              style={[styles.submitBtn, { backgroundColor: colors.primary, opacity: isFormValid ? 1 : 0.45 }]}
              onPress={addBet}
              disabled={!isFormValid}
              activeOpacity={0.82}
            >
              <Feather name="plus" size={16} color={colors.primaryForeground} />
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
  statsGrid: {
    flexDirection: "row",
    gap: 10,
    padding: 16,
    paddingBottom: 8,
  },
  list: { paddingHorizontal: 16, paddingBottom: 120, gap: 10 },
  betCard: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
    flexDirection: "row",
  },
  betAccent: { width: 3 },
  betInner: { flex: 1 },
  betHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    padding: 14,
    paddingBottom: 10,
    gap: 8,
  },
  betLeft: { flex: 1, gap: 3 },
  betMatchup: { fontSize: 14, fontFamily: "Inter_600SemiBold", letterSpacing: -0.2 },
  betPick: { fontSize: 12, fontFamily: "Inter_500Medium" },
  betMeta: { fontSize: 11, fontFamily: "Inter_400Regular" },
  betRight: { alignItems: "flex-end", gap: 2 },
  betStake: { fontSize: 15, fontFamily: "Inter_700Bold" },
  betProfit: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  betActions: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
  },
  resultBtn: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
  },
  resultText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  deleteBtn: {
    width: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  fab: {
    position: "absolute",
    bottom: 110,
    right: 20,
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 10,
  },
  modal: { flex: 1, paddingTop: 12 },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 12,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalTitle: { fontSize: 18, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  modalBody: { padding: 20, gap: 14, paddingBottom: 60 },
  field: { gap: 6 },
  fieldLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", letterSpacing: 0.3, textTransform: "uppercase" },
  fieldRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
  },
  fieldInput: {
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: 13,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  submitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 15,
    borderRadius: 14,
    marginTop: 6,
  },
  submitText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
});
