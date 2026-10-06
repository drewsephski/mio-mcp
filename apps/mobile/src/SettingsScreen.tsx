import { useEffect, useState } from "react";
import { Linking, Text, View } from "react-native";
import * as Apple from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import { linkApple, mio, safeMessage, webUrl } from "./client";
import { DotsRing } from "./dots-ring";
import { Button, Card, Feedback, Field, styles } from "./ui";

export function SettingsScreen({ signOut, signingOut }: { signOut(): void; signingOut: boolean }) {
  const [timezone, setTimezone] = useState(""), [offset, setOffset] = useState("15"), [start, setStart] = useState(""), [end, setEnd] = useState("");
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [feedback, setFeedback] = useState("");
  const [apple, setApple] = useState(false);
  const [operation, setOperation] = useState<"save" | "apple">("save");
  useEffect(() => {
    let alive = true;
    void mio.preferences().then(p => { if (alive) { setTimezone(p.timezone); setOffset(String(p.defaultOffsetMinutes)); setStart(p.quietHoursStart); setEnd(p.quietHoursEnd); } }).catch(e => { if (alive) setFeedback(safeMessage(e)); }).finally(() => { if (alive) setLoading(false); });
    if (process.env.EXPO_PUBLIC_MIO_APPLE_LINK_ENABLED === "true") void Apple.isAvailableAsync().then(value => { if (alive) setApple(value); });
    return () => { alive = false; };
  }, []);
  async function save() {
    setOperation("save");
    setBusy(true); setFeedback("");
    try { await mio.savePreferences({ timezone, defaultOffsetMinutes: Number(offset), quietHoursStart: start, quietHoursEnd: end }); setFeedback("Preferences saved."); }
    catch (e) { setFeedback(safeMessage(e)); } finally { setBusy(false); }
  }
  async function connectApple() {
    setOperation("apple");
    setBusy(true); setFeedback("");
    try {
      const nonce = Crypto.randomUUID();
      const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);
      const result = await Apple.signInAsync({ requestedScopes: [Apple.AppleAuthenticationScope.EMAIL, Apple.AppleAuthenticationScope.FULL_NAME], nonce: hashed });
      if (!result.identityToken) throw new Error("Apple sign-in couldn’t be confirmed.");
      await linkApple(result.identityToken, nonce); setFeedback("Apple is linked to this Mio account.");
    } catch (e) { setFeedback(safeMessage(e)); } finally { setBusy(false); }
  }
  return <><Text style={styles.title}>Settings</Text><Feedback error={feedback} loading={loading} /><Card><Text style={styles.heading}>Reminders and time</Text>
    <Field label="Timezone" value={timezone} onChange={setTimezone} /><Field label="Minutes before an event" value={offset} onChange={setOffset} />
    <Field label="Quiet hours start · HH:MM, or blank" value={start} onChange={setStart} /><Field label="Quiet hours end · HH:MM, or blank" value={end} onChange={setEnd} />
    <Button title="Save preferences" loading={busy && operation === "save"} onPress={() => void save()} disabled={loading || busy} />
  </Card><Card><Text style={styles.heading}>Your account</Text><Button title="Phone connection and account" secondary onPress={() => void Linking.openURL(`${webUrl}/settings`)} />
    {apple && <><Text style={styles.muted}>Link Apple to the Mio account you’re already using.</Text><View style={{ width: "100%", height: 48 }}><Apple.AppleAuthenticationButton buttonType={Apple.AppleAuthenticationButtonType.CONTINUE} buttonStyle={Apple.AppleAuthenticationButtonStyle.BLACK} cornerRadius={8} style={{ width: "100%", height: 48, opacity: busy && operation === "apple" ? 0 : 1 }} onPress={() => { if (!busy) void connectApple(); }} />{busy && operation === "apple" && <View style={{ position: "absolute", inset: 0, borderRadius: 8, backgroundColor: "#000000", alignItems: "center", justifyContent: "center" }}><DotsRing size={20} color="#ffffff" label="Linking Apple" /></View>}</View></>}
    <Button title="Sign out" loading={signingOut} secondary onPress={signOut} disabled={busy} />
    <Button title="Privacy and terms" secondary onPress={() => void Linking.openURL(`${webUrl}/privacy`)} />
  </Card></>;
}
