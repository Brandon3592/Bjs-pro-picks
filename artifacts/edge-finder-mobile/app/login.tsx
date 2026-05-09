import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { useRouter } from "expo-router";
import { useSession } from "./_layout";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

const STORED_TOKEN_KEY = "ef_session_token";
const STORED_EMAIL_KEY = "ef_stored_email";
const STORED_BIOMETRIC_KEY = "ef_biometric_enabled";

type Mode = "login" | "register";

function getBaseUrl(): string {
  if (process.env.EXPO_PUBLIC_DOMAIN) {
    return `https://${process.env.EXPO_PUBLIC_DOMAIN}`;
  }
  return "";
}

async function apiPost(path: string, body: object): Promise<{ ok: boolean; status: number; data: any }> {
  const res = await fetch(`${getBaseUrl()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export default function LoginScreen() {
  const colors = useColors();
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checkingBio, setCheckingBio] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricType, setBiometricType] = useState<"fingerprint" | "face" | "biometric">("biometric");

  useEffect(() => {
    bootstrapAuth();
  }, []);

  async function bootstrapAuth() {
    setCheckingBio(true);
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      const supportedTypes = await LocalAuthentication.supportedAuthenticationTypesAsync();

      if (hasHardware && isEnrolled) {
        setBiometricAvailable(true);
        if (supportedTypes.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
          setBiometricType("face");
        } else if (supportedTypes.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
          setBiometricType("fingerprint");
        }

        const isBioEnabled = await SecureStore.getItemAsync(STORED_BIOMETRIC_KEY);
        const storedToken = await SecureStore.getItemAsync(STORED_TOKEN_KEY);
        const storedEmail = await SecureStore.getItemAsync(STORED_EMAIL_KEY);

        if (isBioEnabled === "true" && storedToken && storedEmail) {
          setBiometricEnabled(true);
          setEmail(storedEmail);
          // Auto-prompt biometric
          await attemptBiometricLogin(storedToken);
          return;
        }
      }
    } catch {
      // ignore — fall through to manual login
    } finally {
      setCheckingBio(false);
    }
  }

  async function attemptBiometricLogin(token?: string) {
    const storedToken = token ?? await SecureStore.getItemAsync(STORED_TOKEN_KEY);
    if (!storedToken) return;

    const typeLabel = biometricType === "face" ? "Face ID" : biometricType === "fingerprint" ? "Fingerprint" : "Biometric";

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: `Sign in with ${typeLabel}`,
      cancelLabel: "Use Password",
      disableDeviceFallback: false,
    });

    if (result.success) {
      await loginWithToken(storedToken);
    }
  }

  const { signIn } = useSession();

  async function loginWithToken(token: string) {
    await signIn(token);
    router.replace("/(tabs)/value-bets");
  }

  async function submit() {
    setError(null);
    if (!email.trim() || !password) {
      setError("Email and password are required");
      return;
    }

    setLoading(true);
    try {
      let result;
      if (mode === "login") {
        result = await apiPost("/api/auth/mobile-login", { email: email.trim(), password });
      } else {
        if (password.length < 8) {
          setError("Password must be at least 8 characters");
          setLoading(false);
          return;
        }
        result = await apiPost("/api/auth/mobile-register", { email: email.trim(), password, firstName, lastName });
      }

      if (!result.ok) {
        setError(result.data.error || "Something went wrong");
        return;
      }

      const { token } = result.data;

      // Offer biometric setup after first login (if available and not yet enabled)
      const isBioEnabled = await SecureStore.getItemAsync(STORED_BIOMETRIC_KEY);
      if (biometricAvailable && isBioEnabled !== "true") {
        const typeLabel = biometricType === "face" ? "Face ID / Facial Recognition" : biometricType === "fingerprint" ? "Fingerprint" : "Biometric";
        Alert.alert(
          `Enable ${typeLabel}?`,
          `Sign in faster next time with ${typeLabel} instead of typing your password.`,
          [
            {
              text: "Not now",
              style: "cancel",
              onPress: () => loginWithToken(token),
            },
            {
              text: "Enable",
              onPress: async () => {
                await SecureStore.setItemAsync(STORED_BIOMETRIC_KEY, "true");
                await SecureStore.setItemAsync(STORED_EMAIL_KEY, email.trim().toLowerCase());
                await loginWithToken(token);
              },
            },
          ],
        );
      } else {
        await loginWithToken(token);
      }
    } catch {
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  }

  const styles = makeStyles(colors);

  if (checkingBio) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  const bioLabel = biometricType === "face" ? "Face ID" : biometricType === "fingerprint" ? "Fingerprint" : "Biometric";
  const bioIcon = biometricType === "face" ? "smile" : "thumbs-up";

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        {/* Logo */}
        <View style={styles.logoWrap}>
          <View style={[styles.logoIcon, { backgroundColor: colors.primary + "20", borderColor: colors.primary + "40" }]}>
            <Feather name="zap" size={28} color={colors.primary} />
          </View>
          <Text style={[styles.appName, { color: colors.foreground }]}>BJ's Pro Picks</Text>
          <Text style={[styles.appSub, { color: colors.mutedForeground }]}>Sports betting intelligence</Text>
        </View>

        {/* Card */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {/* Tab switcher */}
          <View style={[styles.tabRow, { backgroundColor: colors.muted }]}>
            <Pressable
              style={[styles.tab, mode === "login" && [styles.tabActive, { backgroundColor: colors.card }]]}
              onPress={() => { setMode("login"); setError(null); }}
            >
              <Text style={[styles.tabText, { color: mode === "login" ? colors.foreground : colors.mutedForeground }]}>Sign In</Text>
            </Pressable>
            <Pressable
              style={[styles.tab, mode === "register" && [styles.tabActive, { backgroundColor: colors.card }]]}
              onPress={() => { setMode("register"); setError(null); }}
            >
              <Text style={[styles.tabText, { color: mode === "register" ? colors.foreground : colors.mutedForeground }]}>Create Account</Text>
            </Pressable>
          </View>

          {/* Name fields (register only) */}
          {mode === "register" && (
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>First Name</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                  placeholder="BJ"
                  placeholderTextColor={colors.mutedForeground}
                  value={firstName}
                  onChangeText={setFirstName}
                  autoCapitalize="words"
                  autoComplete="given-name"
                  textContentType="givenName"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>Last Name</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                  placeholder="Smith"
                  placeholderTextColor={colors.mutedForeground}
                  value={lastName}
                  onChangeText={setLastName}
                  autoCapitalize="words"
                  autoComplete="family-name"
                  textContentType="familyName"
                />
              </View>
            </View>
          )}

          {/* Email */}
          <View>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Email</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
              placeholder="you@example.com"
              placeholderTextColor={colors.mutedForeground}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              textContentType="emailAddress"
            />
          </View>

          {/* Password */}
          <View>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Password</Text>
            <View style={styles.pwWrap}>
              <TextInput
                style={[styles.input, styles.pwInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                placeholder={mode === "register" ? "At least 8 characters" : "••••••••"}
                placeholderTextColor={colors.mutedForeground}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPw}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                textContentType={mode === "login" ? "password" : "newPassword"}
              />
              <Pressable style={styles.eyeBtn} onPress={() => setShowPw(!showPw)}>
                <Feather name={showPw ? "eye-off" : "eye"} size={18} color={colors.mutedForeground} />
              </Pressable>
            </View>
          </View>

          {/* Error */}
          {error && (
            <View style={[styles.errorBox, { backgroundColor: colors.destructive + "18", borderColor: colors.destructive + "40" }]}>
              <Feather name="alert-circle" size={14} color={colors.destructive} />
              <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
            </View>
          )}

          {/* Submit */}
          <Pressable
            style={[styles.submitBtn, { backgroundColor: colors.primary }, loading && { opacity: 0.6 }]}
            onPress={submit}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.submitText}>{mode === "login" ? "Sign In" : "Create Account"}</Text>
            )}
          </Pressable>

          {/* Biometric login shortcut */}
          {mode === "login" && biometricAvailable && biometricEnabled && (
            <Pressable
              style={[styles.bioBtn, { borderColor: colors.border }]}
              onPress={() => attemptBiometricLogin()}
            >
              <Feather name={bioIcon as any} size={20} color={colors.primary} />
              <Text style={[styles.bioText, { color: colors.foreground }]}>Sign in with {bioLabel}</Text>
            </Pressable>
          )}
        </View>

        <Text style={[styles.footer, { color: colors.mutedForeground }]}>
          For entertainment purposes only. Bet responsibly.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    scroll: {
      flexGrow: 1,
      padding: 24,
      paddingTop: Platform.OS === "ios" ? 80 : 60,
      paddingBottom: 40,
    },
    logoWrap: { alignItems: "center", marginBottom: 32 },
    logoIcon: {
      width: 64,
      height: 64,
      borderRadius: 20,
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 14,
    },
    appName: { fontSize: 24, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
    appSub: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 4 },
    card: {
      borderRadius: 20,
      borderWidth: 1,
      padding: 20,
      gap: 16,
    },
    tabRow: {
      flexDirection: "row",
      borderRadius: 10,
      padding: 4,
      gap: 4,
    },
    tab: {
      flex: 1,
      paddingVertical: 8,
      borderRadius: 8,
      alignItems: "center",
    },
    tabActive: {
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.1,
      shadowRadius: 2,
      elevation: 2,
    },
    tabText: { fontSize: 14, fontFamily: "Inter_500Medium" },
    row: { flexDirection: "row", gap: 12 },
    label: { fontSize: 12, fontFamily: "Inter_500Medium", marginBottom: 6 },
    input: {
      borderWidth: 1,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 15,
      fontFamily: "Inter_400Regular",
    },
    pwWrap: { position: "relative" },
    pwInput: { paddingRight: 44 },
    eyeBtn: {
      position: "absolute",
      right: 14,
      top: 0,
      bottom: 0,
      justifyContent: "center",
    },
    errorBox: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      borderWidth: 1,
      borderRadius: 10,
      padding: 12,
    },
    errorText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular" },
    submitBtn: {
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: "center",
      justifyContent: "center",
    },
    submitText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
    bioBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
      borderWidth: 1,
      borderRadius: 12,
      paddingVertical: 13,
    },
    bioText: { fontSize: 15, fontFamily: "Inter_500Medium" },
    footer: {
      textAlign: "center",
      fontSize: 11,
      fontFamily: "Inter_400Regular",
      marginTop: 24,
    },
    destructive: colors.destructive,
  });
}
