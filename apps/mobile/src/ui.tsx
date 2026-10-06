import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
export const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#f8faff" }, content: { padding: 22, gap: 20 },
  title: { fontSize: 32, fontWeight: "600", color: "#172033", letterSpacing: -1 },
  heading: { fontSize: 20, fontWeight: "600", color: "#172033" },
  text: { fontSize: 16, lineHeight: 24, color: "#172033" }, muted: { fontSize: 14, lineHeight: 21, color: "#627087" },
  card: { padding: 18, gap: 12, backgroundColor: "#ffffff", borderRadius: 16, borderColor: "#e5eaf1", borderWidth: 1 },
  input: { fontSize: 16, backgroundColor: "#ffffff", color: "#172033", padding: 14, borderRadius: 10, borderColor: "#e5eaf1", borderWidth: 1 },
  button: { minHeight: 48, padding: 14, borderRadius: 12, backgroundColor: "#2458d3", alignItems: "center", justifyContent: "center" },
  secondary: { backgroundColor: "#f2f6ff" }, buttonText: { color: "#ffffff", fontSize: 16, fontWeight: "600" },
  error: { color: "#b42335", fontSize: 15, lineHeight: 22 }, row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
export function Button({ title, onPress, disabled = false, secondary = false }: { title: string; onPress(): void; disabled?: boolean; secondary?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={[styles.button, secondary && styles.secondary, disabled && { opacity: 0.5 }]}><Text style={[styles.buttonText, secondary && { color: "#2458d3" }]}>{title}</Text></Pressable>;
}
export function Field({ label, value, onChange, multiline = false, secure = false, email = false }: { label: string; value: string; onChange(value: string): void; multiline?: boolean; secure?: boolean; email?: boolean }) {
  return <View style={{ gap: 6 }}><Text style={styles.muted}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={onChange} style={[styles.input, multiline && { minHeight: 150, textAlignVertical: "top" }]} multiline={multiline} secureTextEntry={secure} autoCapitalize={email ? "none" : "sentences"} autoCorrect={!email && !secure} keyboardType={email ? "email-address" : "default"} /></View>;
}
export function Card({ children }: { children: ReactNode }) { return <View style={styles.card}>{children}</View>; }
export function Feedback({ error, loading }: { error?: string; loading?: boolean }) { return <>{loading && <ActivityIndicator accessibilityLabel="Loading Mio" color="#2458d3" />}{error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}</>; }
