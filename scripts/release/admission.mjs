import { execFileSync } from "node:child_process";
import { Query } from "node-appwrite";
export function consoleCall(args) {
  try { return JSON.parse(execFileSync("appwrite", ["project", ...args, "--raw"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })); }
  catch { throw new Error("Appwrite console operation failed; check CLI login and project permissions"); }
}
export async function configureAdmission(ctx, invited, apply) {
  const users = [];
  let cursor;
  do {
    const page = await ctx.users.list({ queries: [Query.orderAsc("$id"), Query.limit(100), ...(cursor ? [Query.cursorAfter(cursor)] : [])] });
    users.push(...page.users); cursor = page.users.length === 100 ? page.users.at(-1).$id : undefined;
    if (users.length > 10_000) throw new Error("Admission inspection exceeds beta capacity");
  } while (cursor);
  const connections = await ctx.tables.listRows({ databaseId: "mio", tableId: "sms_connections", queries: [Query.limit(100), Query.select(["ownerId"])] });
  if (connections.total > 100) throw new Error("Connection admission inspection page overflow");
  for (const c of connections.rows) {
    const user = users.find(u => u.$id === c.ownerId);
    if (!user || !user.status || !user.emailVerification || !invited.includes(user.email.toLowerCase())) throw new Error("An existing connected user would lose admission; inspect the invite list");
  }
  const operator = users.find(u => u.$id === process.env.MIO_OPERATOR_USER_ID);
  if (!operator?.status || !operator.emailVerification || !invited.includes(operator.email.toLowerCase())) throw new Error("Operator must resolve to an active verified invited account");
  const project = consoleCall(["get"]);
  const policy = consoleCall(["get-policy", "--policy-id", "user-limit"]);
  if (!apply) return { publicSignupClosed: policy.total === 1, methods: project.authMethods, preservedConnections: connections.total };
  // Label before tightening table/bucket policies; preserve unrelated labels.
  for (const user of users) if (user.status && user.emailVerification && invited.includes(user.email.toLowerCase()) && !user.labels.includes("mioBeta")) await ctx.users.updateLabels({ userId: user.$id, labels: [...user.labels, "mioBeta"] });
  if (policy.total !== 1) consoleCall(["update-user-limit-policy", "--total", "1"]);
  for (const method of ["anonymous", "phone", "email-otp", "magic-url"]) if (project.authMethods.find(x => x.$id === method)?.enabled !== false) consoleCall(["update-auth-method", "--method-id", method, "--enabled=false"]);
  const updated = consoleCall(["get"]), limit = consoleCall(["get-policy", "--policy-id", "user-limit"]);
  if (limit.total !== 1 || ["anonymous", "phone", "email-otp", "magic-url"].some(m => updated.authMethods.find(x => x.$id === m)?.enabled !== false)) throw new Error("Public signup policy did not converge");
  return { publicSignupClosed: true, preservedConnections: connections.total };
}
