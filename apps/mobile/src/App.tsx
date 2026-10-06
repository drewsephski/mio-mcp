import { useEffect, useState } from "react";
import { AppState, Linking, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { messagesLink, type CompanionUser, type PhoneStatus } from "@mio/domain";
import { isAccessError, mio, safeMessage, webUrl } from "./client";
import { TodayScreen } from "./TodayScreen";
import { NotesScreen } from "./NotesScreen";
import { RemindersScreen } from "./RemindersScreen";
import { SettingsScreen } from "./SettingsScreen";
import { Button, Card, Feedback, Field, styles } from "./ui";
type Tab = "Today" | "Notes" | "Reminders" | "Settings";
export default function App() {
  const [user, setUser] = useState<CompanionUser | null>(null), [phone, setPhone] = useState<PhoneStatus | null>(null);
  const [email, setEmail] = useState(""), [password, setPassword] = useState(""), [tab, setTab] = useState<Tab>("Today");
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    void mio.session().then(u => { if (alive) setUser(u); }).catch(() => {}).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    if (!user) return;
    let alive = true;
    const refresh = () => { void mio.status().then(s => { if (alive) setPhone(s); }).catch(e => { if (alive) { setError(safeMessage(e)); if (isAccessError(e)) { setUser(null); setPhone(null); } } }); };
    refresh();
    void mio.visit().catch(() => { /* First-party visit failure never blocks the companion. */ });
    const subscription = AppState.addEventListener("change", state => { if (state === "active") refresh(); });
    return () => { alive = false; subscription.remove(); };
  }, [user]);
  async function signIn() {
    setLoading(true); setError("");
    try { setUser(await mio.signIn(email, password)); setPassword(""); }
    catch (e) { setError(safeMessage(e)); } finally { setLoading(false); }
  }
  async function signOut() {
    setLoading(true); setError("");
    try { await mio.signOut(); setUser(null); setPhone(null); setTab("Today"); }
    catch (e) { setError(safeMessage(e)); } finally { setLoading(false); }
  }
  function textMio() {
    const url = phone?.connected ? messagesLink(phone.mioPhone) : `${webUrl}/onboarding`;
    void Linking.openURL(url).catch(() => setError("Messages couldn’t open. Use your phone’s Messages app to text Mio."));
  }
  return <SafeAreaProvider><SafeAreaView style={styles.root}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
    <Text style={styles.heading}>mio</Text><Feedback error={error} loading={loading} />{!user ? <Card><Text style={styles.title}>Welcome back.</Text><Text style={styles.muted}>Sign in with your verified invited Mio account.</Text>
      <Field label="Email" value={email} onChange={setEmail} email /><Field label="Password" value={password} onChange={setPassword} secure />
      <Button title="Sign in" loading={loading} onPress={() => void signIn()} disabled={loading || !email || !password} />
      <Button title="Create or recover your invited account" secondary onPress={() => void Linking.openURL(`${webUrl}/auth`)} />
    </Card> : <><Button title={phone?.connected ? "Text Mio" : "Connect your phone"} onPress={textMio} disabled={!phone} loading={!phone && !error} />
      {tab === "Today" ? <TodayScreen /> : tab === "Notes" ? <NotesScreen /> : tab === "Reminders" ? <RemindersScreen /> : <SettingsScreen signOut={() => void signOut()} signingOut={loading} />}
    </>}
  </ScrollView>{user && <View style={{ flexDirection: "row", borderTopColor: "#e5eaf1", borderTopWidth: 1 }}>{(["Today", "Notes", "Reminders", "Settings"] as const).map(t => <Pressable key={t} accessibilityRole="tab" accessibilityState={{ selected: tab === t }} onPress={() => setTab(t)} style={{ flex: 1, paddingVertical: 18, alignItems: "center" }}><Text style={[styles.muted, tab === t && { fontWeight: "700", color: "#2458d3" }]}>{t}</Text></Pressable>)}</View>}</SafeAreaView></SafeAreaProvider>;
}
