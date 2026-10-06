import { Account, AppwriteException, Client, ExecutionMethod, Functions, IdTokenProvider, Query, TablesDB } from "react-native-appwrite";
import { CompanionAccessError, createCompanionClient, type CompanionPort } from "@mio/domain";
import { ZodError } from "zod";

export const webUrl = process.env.EXPO_PUBLIC_MIO_WEB_URL ?? "https://6ac511fd00064c0f429d.appwrite.network";
const sdk = new Client().setEndpoint(process.env.EXPO_PUBLIC_APPWRITE_ENDPOINT ?? "https://nyc.cloud.appwrite.io/v1")
  .setProject(process.env.EXPO_PUBLIC_APPWRITE_PROJECT_ID ?? "68d13a4a000d854004b3").setPlatform("com.mio.companion");
const account = new Account(sdk), functions = new Functions(sdk), tables = new TablesDB(sdk);
const notes = { databaseId: "mio", tableId: "notes" };
const port: CompanionPort = {
  account: () => account.get(),
  async signIn(email, password) { await account.createEmailPasswordSession({ email, password }); },
  async signOut() { await account.deleteSession({ sessionId: "current" }); },
  async call(path, body, query) {
    const params = new URLSearchParams(query);
    const result = await functions.createExecution({ functionId: "mio-sms", xpath: `${path}${params.size ? `?${params}` : ""}`,
      method: body === undefined ? ExecutionMethod.GET : ExecutionMethod.POST, body: body === undefined ? undefined : JSON.stringify(body), async: false });
    if (result.responseStatusCode < 200 || result.responseStatusCode >= 300) {
      let message = "Mio couldn’t confirm that request. Refresh before trying again.";
      try { const value: unknown = JSON.parse(result.responseBody); if (value && typeof value === "object" && "error" in value && typeof value.error === "string" && [400, 403, 404, 409, 429].includes(result.responseStatusCode)) message = value.error; } catch { /* Unavailable runtime may return HTML. */ }
      if ([401, 403].includes(result.responseStatusCode)) throw new CompanionAccessError(message);
      throw new Error(message);
    }
    return JSON.parse(result.responseBody) as unknown;
  },
  async listNotes(ownerId, cursor) {
    const queries = [Query.equal("ownerId", ownerId), Query.equal("archived", false), Query.orderDesc("$updatedAt"), Query.orderDesc("$id"), Query.limit(26)];
    if (cursor) queries.push(Query.cursorAfter(cursor));
    return (await tables.listRows({ ...notes, queries })).rows;
  },
  getNote: rowId => tables.getRow({ ...notes, rowId }),
  updateNote: (rowId, data) => tables.updateRow({ ...notes, rowId, data }),
};
export const mio = createCompanionClient(port);
export function isAccessError(error: unknown) { return error instanceof CompanionAccessError || error instanceof AppwriteException && [401, 403].includes(error.code); }
export function safeMessage(error: unknown) {
  if (error instanceof ZodError) return "Mio couldn’t validate these details. Check your fields, or refresh if data couldn’t load.";
  if (error instanceof AppwriteException) {
    if (error.code === 401) return "Sign in again to continue.";
    if (error.code === 403) return "Use your verified invited Mio account.";
    return "Mio couldn’t confirm this request. Refresh to check before trying again.";
  }
  return error instanceof Error ? error.message : "Mio is temporarily unavailable.";
}

// Settings-only linking: never a public account-creation path. Appwrite binds
// native ID-token sessions to the current account. Verify that identity after.
export async function linkApple(idToken: string, nonce: string) {
  const before = await mio.session();
  await account.createIdTokenSession({ provider: IdTokenProvider.Apple, idToken, nonce });
  const after = await mio.session();
  if (after.$id !== before.$id) {
    await mio.signOut();
    throw new Error("Apple linking couldn’t be confirmed. Sign in with your Mio email.");
  }
}
