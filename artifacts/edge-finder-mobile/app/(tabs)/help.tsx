import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

type Status = "idle" | "submitting" | "success" | "error";

const API_BASE = process.env.EXPO_PUBLIC_DOMAIN
  ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
  : "";

export default function HelpScreen() {
  const colors = useColors();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit() {
    if (!name.trim() || !email.trim() || !subject.trim() || !message.trim()) return;
    setStatus("submitting");
    setErrorMsg("");
    try {
      const res = await fetch(`${API_BASE}/api/support/help`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          subject: subject.trim(),
          message: message.trim(),
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as any).error || "Failed to submit");
      }
      setStatus("success");
      setSubject("");
      setMessage("");
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    }
  }

  const canSubmit =
    Boolean(name.trim()) && Boolean(email.trim()) && Boolean(subject.trim()) && Boolean(message.trim()) && status !== "submitting";

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={[styles.container, { paddingBottom: 80 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={[styles.iconWrap, { backgroundColor: colors.primary + "20" }]}>
            <Feather name="help-circle" size={22} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.headerTitle, { color: colors.foreground }]}>Help & Support</Text>
            <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
              Questions, comments, or concerns? We'll reply by email.
            </Text>
          </View>
        </View>

        {/* Info row */}
        <View style={styles.infoRow}>
          {[
            { icon: "message-square", label: "Submit a request" },
            { icon: "clock", label: "24–48h response" },
            { icon: "mail", label: "Email reply" },
          ].map(({ icon, label }) => (
            <View key={label} style={[styles.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name={icon as any} size={14} color={colors.primary} />
              <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>{label}</Text>
            </View>
          ))}
        </View>

        {/* Success banner */}
        {status === "success" && (
          <View style={[styles.banner, { backgroundColor: colors.primary + "18", borderColor: colors.primary + "44" }]}>
            <Feather name="check-circle" size={16} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.bannerTitle, { color: colors.primary }]}>Message sent!</Text>
              <Text style={[styles.bannerBody, { color: colors.mutedForeground }]}>
                We'll reply to {email} soon.
              </Text>
            </View>
          </View>
        )}

        {/* Error banner */}
        {status === "error" && (
          <View style={[styles.banner, { backgroundColor: "#ef444418", borderColor: "#ef444444" }]}>
            <Feather name="alert-circle" size={14} color="#ef4444" />
            <Text style={[styles.errorText, { color: "#ef4444" }]}>{errorMsg}</Text>
          </View>
        )}

        {/* Form card */}
        <View style={[styles.formCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Send us a message</Text>

          {/* Name + Email */}
          <View style={styles.row}>
            <View style={styles.halfField}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>YOUR NAME</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Full name"
                placeholderTextColor={colors.mutedForeground + "60"}
                style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
              />
            </View>
            <View style={styles.halfField}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>EMAIL</Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="you@email.com"
                placeholderTextColor={colors.mutedForeground + "60"}
                keyboardType="email-address"
                autoCapitalize="none"
                style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
              />
            </View>
          </View>

          {/* Subject */}
          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>SUBJECT</Text>
            <TextInput
              value={subject}
              onChangeText={setSubject}
              placeholder="Brief description of your question or issue"
              placeholderTextColor={colors.mutedForeground + "60"}
              style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
            />
          </View>

          {/* Message */}
          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>MESSAGE</Text>
            <TextInput
              value={message}
              onChangeText={setMessage}
              placeholder="Describe your question, comment, or concern…"
              placeholderTextColor={colors.mutedForeground + "60"}
              multiline
              numberOfLines={6}
              textAlignVertical="top"
              style={[styles.textarea, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
            />
          </View>

          {/* Submit */}
          <TouchableOpacity
            onPress={handleSubmit}
            disabled={!canSubmit}
            style={[styles.submitBtn, { backgroundColor: canSubmit ? colors.primary : colors.primary + "60" }]}
            activeOpacity={0.8}
          >
            {status === "submitting" ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Feather name="send" size={15} color="#fff" />
            )}
            <Text style={styles.submitLabel}>
              {status === "submitting" ? "Sending…" : "Send Message"}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 16 },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  iconWrap: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 20, fontFamily: "Inter_700Bold", letterSpacing: -0.4 },
  headerSub: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2, lineHeight: 18 },
  infoRow: { flexDirection: "row", gap: 8 },
  infoCard: { flex: 1, borderRadius: 10, borderWidth: 1, padding: 10, gap: 6, alignItems: "flex-start" },
  infoLabel: { fontSize: 10, fontFamily: "Inter_500Medium", lineHeight: 14 },
  banner: { flexDirection: "row", alignItems: "flex-start", gap: 10, borderRadius: 12, borderWidth: 1, padding: 14 },
  bannerTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  bannerBody: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  errorText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  formCard: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 14 },
  sectionTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  row: { flexDirection: "row", gap: 10 },
  halfField: { flex: 1, gap: 5 },
  field: { gap: 5 },
  label: { fontSize: 10, fontFamily: "Inter_600SemiBold", letterSpacing: 0.5 },
  input: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9, fontSize: 13, fontFamily: "Inter_400Regular" },
  textarea: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9, fontSize: 13, fontFamily: "Inter_400Regular", minHeight: 120 },
  submitBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 10, paddingVertical: 13, marginTop: 4 },
  submitLabel: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
