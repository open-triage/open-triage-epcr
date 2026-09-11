import { hostname, userInfo } from "node:os";
import { DataSource } from "typeorm";
import { AccountService } from "./account.service.js";

type ParsedOptions = Map<string, string | true>;

function options(argv: string[]): ParsedOptions {
  const parsed: ParsedOptions = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key?.startsWith("--")) throw new Error(`Unexpected argument ${key ?? ""}`);
    const name = key.slice(2);
    if (parsed.has(name)) throw new Error(`Duplicate option --${name}`);
    if (name === "clinician") {
      parsed.set(name, true);
      continue;
    }
    const optionValue = argv[index + 1];
    if (!optionValue || optionValue.startsWith("--")) throw new Error(`Missing value for ${key}`);
    parsed.set(name, optionValue);
    index += 1;
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

function value(parsed: ParsedOptions, name: string): string | undefined {
  const candidate = parsed.get(name);
  return typeof candidate === "string" ? candidate : undefined;
}

function assertOnly(parsed: ParsedOptions, allowed: readonly string[]): void {
  for (const key of parsed.keys()) if (!allowed.includes(key)) throw new Error(`Unknown option --${key}`);
}

export async function runIdentityAccountCli(
  dataSource: DataSource,
  argv: string[],
  dependencies: { readPassword?: () => Promise<string>; osAccount?: string; host?: string } = {}
): Promise<Record<string, string | boolean>> {
  const command = argv[0];
  const parsed = options(argv.slice(1));
  const operatorId = value(parsed, "operator-id");
  const operator = {
    operatorId: operatorId ?? "",
    osAccount: dependencies.osAccount ?? userInfo().username,
    host: dependencies.host ?? hostname()
  };
  const passwordReader = dependencies.readPassword ?? readTemporaryPassword;
  const service = new AccountService(dataSource);

  if (command === "bootstrap-owner") {
    assertOnly(parsed, ["organization-id", "username", "display-name", "operator-id", "clinician"]);
    const organizationId = value(parsed, "organization-id");
    const username = value(parsed, "username");
    const displayName = value(parsed, "display-name");
    if (!organizationId || !username || !displayName || !operatorId) {
      throw new Error("bootstrap-owner requires --organization-id, --username, --display-name, and --operator-id");
    }
    return service.bootstrapOwner({ organizationId, username, displayName, operator,
      clinician: parsed.get("clinician") === true, temporaryPassword: await passwordReader() });
  }
  if (command === "reset-owner") {
    assertOnly(parsed, ["organization-id", "operator-id"]);
    const organizationId = value(parsed, "organization-id");
    if (!organizationId || !operatorId) throw new Error("reset-owner requires --organization-id and --operator-id");
    return service.resetOwnerPassword(organizationId, await passwordReader(), operator);
  }
  if (command === "reset-user") {
    assertOnly(parsed, ["user-id", "operator-id"]);
    const userId = value(parsed, "user-id");
    if (!userId || !operatorId) throw new Error("reset-user requires --user-id and --operator-id");
    return service.resetUserPassword(userId, await passwordReader(), operator);
  }
  throw new Error("Usage: identity-account bootstrap-owner|reset-owner|reset-user [options]; temporary password is read from stdin");
}
