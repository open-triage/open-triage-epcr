import { AccountService, type BuiltInAccountRole } from "./account.service.js";

function options(argv: string[]): Map<string, string> {
  const parsed = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error(`Missing value for ${key ?? "option"}`);
    parsed.set(key.slice(2), value);
  }
  return parsed;
}

async function readTemporaryPassword(): Promise<string> {
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    const password = Buffer.concat(chunks).toString("utf8").replace(/[\r\n]+$/, "");
    if (!password) throw new Error("A temporary password is required on standard input");
    return password;
  }

  process.stderr.write("Temporary password: ");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let password = "";
    const restore = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stderr.write("\n");
    };
    const onData = (chunk: Buffer) => {
      for (const byte of chunk) {
        if (byte === 3) {
          process.stdin.off("data", onData);
          restore();
          reject(new Error("Canceled"));
          return;
        }
        if (byte === 10 || byte === 13) {
          process.stdin.off("data", onData);
          restore();
          resolve(password);
          return;
        }
        if (byte === 127 || byte === 8) password = password.slice(0, -1);
        else password += String.fromCharCode(byte);
      }
    };
    process.stdin.on("data", onData);
  });
}

type DatabaseClient = { query<T = unknown>(sql: string, parameters?: unknown[]): Promise<T> };

export async function runIdentityAccountCli(client: DatabaseClient, argv: string[]): Promise<Record<string, string>> {
  const command = argv[0];
  const parsed = options(argv.slice(1));
  const temporaryPassword = await readTemporaryPassword();
  const service = new AccountService(client);
  if (command === "provision") {
    const organizationId = parsed.get("organization-id");
    const username = parsed.get("username");
    const displayName = parsed.get("display-name");
    const role = parsed.get("role") as BuiltInAccountRole | undefined;
    if (!organizationId || !username || !displayName || !role || !["owner", "clinician"].includes(role)) {
      throw new Error("provision requires --organization-id, --username, --display-name, and --role owner|clinician");
    }
    return service.provision({ organizationId, username, displayName, role, temporaryPassword });
  }
  if (command === "reset") {
    const username = parsed.get("username");
    if (!username) throw new Error("reset requires --username");
    return service.resetPassword(username, temporaryPassword);
  }
  throw new Error("Usage: identity-account provision|reset [options]; temporary password is read from stdin");
}
