import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  TextInput,
  Linking,
  Platform,
  StyleSheet,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

const API_BASE = process.env.EXPO_PUBLIC_DOMAIN
  ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
  : "";

type AuthUser = { isAdmin: boolean; id: string };

type AdminUser = {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
  createdAt: string;
};

type Submission = {
  id: number;
  userId: string | null;
  name: string;
  email: string;
  subject: string;
  message: string;
  status: string;
  adminReply: string | null;
  repliedAt: string | null;
  createdAt: string;
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function AdminScreen() {
  const colors = useColors();
  const [tab, setTab] = useState<"submissions" | "users">("submissions");
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(false);
  const [replyId, setReplyId] = useState<number | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replyLoading, setReplyLoading] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/auth/user`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setAuthUser(d as AuthUser))
      .finally(() => setAuthLoading(false));
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      if (tab === "users") {
        const r = await fetch(`${API_BASE}/api/admin/users`, { credentials: "include" });
        setUsers(await r.json());
      } else {
        const r = await fetch(`${API_BASE}/api/admin/submissions`, { credentials: "include" });
        setSubmissions(await r.json());
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (authUser?.isAdmin) loadData();
  }, [tab, authUser]);

  async function markRead(id: number) {
    await fetch(`${API_BASE}/api/admin/submissions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ status: "read" }),
    });
    setSubmissions((prev) => prev.map((s) => (s.id === id ? { ...s, status: "read" } : s)));
  }

  async function sendReply(id: number) {
    if (!replyText.trim()) return;
    setReplyLoading(true);
    try {
      const sub = submissions.find((s) => s.id === id);
      if (!sub) return;
      await fetch(`${API_BASE}/api/admin/submissions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ adminReply: replyText }),
      });
      const body = `Hi ${sub.name},\n\n${replyText}\n\n—BJ's Pro Picks Team`;
      const mailto = `mailto:${sub.email}?subject=${encodeURIComponent(`Re: ${sub.subject}`)}&body=${encodeURIComponent(body)}`;
      Linking.openURL(mailto);
      setSubmissions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, status: "replied", adminReply: replyText } : s))
      );
      setReplyId(null);
      setReplyText("");
    } finally {
      setReplyLoading(false);
    }
  }

  const s = makeStyles(colors);

  if (authLoading) {
    return (
      <View style={s.centered}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (!authUser?.isAdmin) {
    return (
      <ScrollView contentContainerStyle={s.centered}>
        <Feather name="shield" size={48} color={colors.mutedForeground} />
        <Text style={[s.restrictedTitle, { color: colors.foreground }]}>Access Restricted</Text>
        <Text style={[s.restrictedSub, { color: colors.mutedForeground }]}>
          This page is only accessible to the site owner.
        </Text>
        {authUser?.id && (
          <View style={[s.idCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[s.idLabel, { color: colors.mutedForeground }]}>Your User ID:</Text>
            <Text style={[s.idValue, { color: colors.foreground }]} selectable>
              {authUser.id}
            </Text>
          </View>
        )}
      </ScrollView>
    );
  }

  const newCount = submissions.filter((sub) => sub.status === "new").length;

  return (
    <View style={[s.root, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[s.header, { borderBottomColor: colors.border }]}>
        <View style={s.headerLeft}>
          <View style={[s.headerIcon, { backgroundColor: colors.primary + "20" }]}>
            <Feather name="shield" size={20} color={colors.primary} />
          </View>
          <View>
            <Text style={[s.headerTitle, { color: colors.foreground }]}>Owner Dashboard</Text>
            <Text style={[s.headerSub, { color: colors.mutedForeground }]}>
              Manage users & support
            </Text>
          </View>
        </View>
        <TouchableOpacity onPress={loadData} disabled={loading} style={s.refreshBtn}>
          <Feather
            name="refresh-cw"
            size={16}
            color={loading ? colors.mutedForeground : colors.foreground}
          />
        </TouchableOpacity>
      </View>

      {/* Tab bar */}
      <View style={[s.tabBar, { borderBottomColor: colors.border }]}>
        {(["submissions", "users"] as const).map((key) => {
          const isActive = tab === key;
          const label = key === "submissions" ? "Help Submissions" : "Registered Users";
          const icon: React.ComponentProps<typeof Feather>["name"] =
            key === "submissions" ? "message-square" : "users";
          return (
            <TouchableOpacity
              key={key}
              onPress={() => setTab(key)}
              style={[s.tabBtn, isActive && { borderBottomColor: colors.primary }]}
            >
              <Feather name={icon} size={14} color={isActive ? colors.primary : colors.mutedForeground} />
              <Text style={[s.tabLabel, { color: isActive ? colors.primary : colors.mutedForeground }]}>
                {label}
              </Text>
              {key === "submissions" && newCount > 0 && (
                <View style={[s.badge, { backgroundColor: colors.primary + "30", borderColor: colors.primary + "60" }]}>
                  <Text style={[s.badgeText, { color: colors.primary }]}>{newCount}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Content */}
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {loading ? (
          <View style={s.centered}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : tab === "users" ? (
          <UsersTab users={users} colors={colors} s={s} />
        ) : (
          <SubmissionsTab
            submissions={submissions}
            colors={colors}
            s={s}
            replyId={replyId}
            replyText={replyText}
            replyLoading={replyLoading}
            onMarkRead={markRead}
            onToggleReply={(id, existing) => {
              if (replyId === id) {
                setReplyId(null);
              } else {
                setReplyId(id);
                setReplyText(existing ?? "");
              }
            }}
            onReplyTextChange={setReplyText}
            onSendReply={sendReply}
          />
        )}
      </ScrollView>
    </View>
  );
}

function UsersTab({ users, colors, s }: { users: AdminUser[]; colors: ReturnType<typeof useColors>; s: ReturnType<typeof makeStyles> }) {
  if (users.length === 0) {
    return (
      <View style={s.emptyWrap}>
        <Feather name="users" size={36} color={colors.mutedForeground} />
        <Text style={[s.emptyText, { color: colors.mutedForeground }]}>No users yet.</Text>
      </View>
    );
  }
  return (
    <View>
      <Text style={[s.countLabel, { color: colors.mutedForeground }]}>
        {users.length} registered {users.length === 1 ? "user" : "users"}
      </Text>
      {users.map((u) => {
        const name = [u.firstName, u.lastName].filter(Boolean).join(" ") || "Unknown";
        const initials = [u.firstName, u.lastName]
          .filter(Boolean)
          .join("")
          .slice(0, 2)
          .toUpperCase() || "?";
        return (
          <View key={u.id} style={[s.userRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[s.avatar, { backgroundColor: colors.primary + "25" }]}>
              <Text style={[s.avatarText, { color: colors.primary }]}>{initials}</Text>
            </View>
            <View style={s.userInfo}>
              <Text style={[s.userName, { color: colors.foreground }]}>{name}</Text>
              <Text style={[s.userEmail, { color: colors.mutedForeground }]}>
                {u.email ?? "No email"} · {timeAgo(u.createdAt)}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function SubmissionsTab({
  submissions, colors, s, replyId, replyText, replyLoading,
  onMarkRead, onToggleReply, onReplyTextChange, onSendReply,
}: {
  submissions: Submission[];
  colors: ReturnType<typeof useColors>;
  s: ReturnType<typeof makeStyles>;
  replyId: number | null;
  replyText: string;
  replyLoading: boolean;
  onMarkRead: (id: number) => void;
  onToggleReply: (id: number, existing: string | null) => void;
  onReplyTextChange: (t: string) => void;
  onSendReply: (id: number) => void;
}) {
  if (submissions.length === 0) {
    return (
      <View style={s.emptyWrap}>
        <Feather name="message-square" size={36} color={colors.mutedForeground} />
        <Text style={[s.emptyText, { color: colors.mutedForeground }]}>No help submissions yet.</Text>
      </View>
    );
  }

  const statusColors: Record<string, { bg: string; text: string; border: string }> = {
    new: { bg: "#f59e0b20", text: "#f59e0b", border: "#f59e0b40" },
    read: { bg: "#3b82f620", text: "#3b82f6", border: "#3b82f640" },
    replied: { bg: colors.primary + "20", text: colors.primary, border: colors.primary + "40" },
  };

  return (
    <View>
      {submissions.map((sub) => {
        const sc = statusColors[sub.status] ?? statusColors.new;
        return (
          <View
            key={sub.id}
            style={[
              s.subCard,
              {
                backgroundColor: colors.card,
                borderColor: sub.status === "new" ? "#f59e0b50" : colors.border,
              },
            ]}
          >
            <View style={s.subHeader}>
              <View style={[s.statusBadge, { backgroundColor: sc.bg, borderColor: sc.border }]}>
                <Text style={[s.statusText, { color: sc.text }]}>{sub.status.toUpperCase()}</Text>
              </View>
              <Text style={[s.subTime, { color: colors.mutedForeground }]}>
                {timeAgo(sub.createdAt)}
              </Text>
            </View>

            <Text style={[s.subSubject, { color: colors.foreground }]}>{sub.subject}</Text>
            <Text style={[s.subFrom, { color: colors.mutedForeground }]}>
              {sub.name} · {sub.email}
            </Text>

            <View style={[s.subMessage, { backgroundColor: colors.mutedForeground + "15" }]}>
              <Text style={[s.subMessageText, { color: colors.mutedForeground }]}>{sub.message}</Text>
            </View>

            {sub.adminReply && (
              <View style={[s.replyPreview, { borderLeftColor: colors.primary + "60" }]}>
                <Text style={[s.replyPreviewLabel, { color: colors.primary }]}>Your reply:</Text>
                <Text style={[s.replyPreviewText, { color: colors.mutedForeground }]}>{sub.adminReply}</Text>
              </View>
            )}

            <View style={s.subActions}>
              {sub.status === "new" && (
                <TouchableOpacity
                  onPress={() => onMarkRead(sub.id)}
                  style={[s.actionBtn, { borderColor: colors.border }]}
                >
                  <Feather name="eye" size={13} color={colors.mutedForeground} />
                  <Text style={[s.actionBtnText, { color: colors.mutedForeground }]}>Mark Read</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={() => onToggleReply(sub.id, sub.adminReply)}
                style={[s.actionBtn, { borderColor: colors.border }]}
              >
                <Feather name="mail" size={13} color={colors.mutedForeground} />
                <Text style={[s.actionBtnText, { color: colors.mutedForeground }]}>
                  {sub.adminReply ? "Edit Reply" : "Reply"}
                </Text>
              </TouchableOpacity>
            </View>

            {replyId === sub.id && (
              <View style={s.replyBox}>
                <TextInput
                  value={replyText}
                  onChangeText={onReplyTextChange}
                  placeholder={`Hi ${sub.name},\n\nThank you for reaching out...`}
                  placeholderTextColor={colors.mutedForeground + "70"}
                  multiline
                  numberOfLines={4}
                  style={[
                    s.replyInput,
                    {
                      backgroundColor: colors.background,
                      borderColor: colors.border,
                      color: colors.foreground,
                    },
                  ]}
                />
                <TouchableOpacity
                  onPress={() => onSendReply(sub.id)}
                  disabled={!replyText.trim() || replyLoading}
                  style={[
                    s.sendBtn,
                    { backgroundColor: colors.primary },
                    (!replyText.trim() || replyLoading) && { opacity: 0.5 },
                  ]}
                >
                  <Feather name="send" size={13} color="#fff" />
                  <Text style={s.sendBtnText}>
                    {replyLoading ? "Opening…" : "Open in Email App"}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    root: { flex: 1 },
    centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24, minHeight: 300 },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    headerLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
    headerIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
    headerTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
    headerSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
    refreshBtn: { padding: 8 },
    tabBar: {
      flexDirection: "row",
      borderBottomWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 8,
    },
    tabBtn: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      paddingVertical: 12,
      borderBottomWidth: 2,
      borderBottomColor: "transparent",
    },
    tabLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
    badge: {
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: 5,
      paddingVertical: 1,
    },
    badgeText: { fontSize: 10, fontFamily: "Inter_700Bold" },
    scroll: { flex: 1 },
    scrollContent: { padding: 14, gap: 10, paddingBottom: 120 },
    countLabel: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 8 },
    userRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      padding: 12,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      marginBottom: 8,
    },
    avatar: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
    avatarText: { fontSize: 13, fontFamily: "Inter_700Bold" },
    userInfo: { flex: 1 },
    userName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
    userEmail: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
    emptyWrap: { alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 60 },
    emptyText: { fontSize: 14, fontFamily: "Inter_400Regular" },
    subCard: {
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      padding: 14,
      gap: 10,
      marginBottom: 10,
    },
    subHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
    statusBadge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
    statusText: { fontSize: 10, fontFamily: "Inter_700Bold" },
    subTime: { fontSize: 11, fontFamily: "Inter_400Regular" },
    subSubject: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
    subFrom: { fontSize: 12, fontFamily: "Inter_400Regular" },
    subMessage: { borderRadius: 8, padding: 10 },
    subMessageText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
    replyPreview: { borderLeftWidth: 2, paddingLeft: 10, gap: 2 },
    replyPreviewLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
    replyPreviewText: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
    subActions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
    actionBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
    },
    actionBtnText: { fontSize: 12, fontFamily: "Inter_500Medium" },
    replyBox: { gap: 8 },
    replyInput: {
      borderWidth: 1,
      borderRadius: 10,
      padding: 10,
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      minHeight: 100,
      textAlignVertical: "top",
    },
    sendBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      paddingVertical: 10,
      borderRadius: 10,
    },
    sendBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" },
    restrictedTitle: { fontSize: 20, fontFamily: "Inter_700Bold", marginTop: 12 },
    restrictedSub: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
    idCard: {
      marginTop: 8,
      padding: 12,
      borderRadius: 12,
      borderWidth: 1,
      width: "100%",
    },
    idLabel: { fontSize: 11, fontFamily: "Inter_400Regular", marginBottom: 4 },
    idValue: { fontSize: 12, fontFamily: "Inter_400Regular" },
  });
}
