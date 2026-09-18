import { pathToFileURL } from "node:url";

const sharedPoolerHost = /\.pooler\.supabase\.com$/i;

function decodedUrlPart(value, name) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error(`${name} is not valid percent-encoded URL data`);
  }
}

function routedLogin(template, login) {
  if (!sharedPoolerHost.test(template.hostname)) return login;
  const templateLogin = decodedUrlPart(template.username, "template database username");
  const separator = templateLogin.indexOf(".");
  if (separator < 1 || separator === templateLogin.length - 1) {
    throw new Error("Shared Supabase pooler username is missing its project reference");
  }
  const projectSuffix = templateLogin.slice(separator);
  return login.endsWith(projectSuffix) ? login : `${login}${projectSuffix}`;
}

export function databaseUrlForLogin(templateUrl, login, password) {
  const url = new URL(templateUrl);
  url.username = routedLogin(url, login);
  url.password = password;
  return url.toString();
}

export function normalizeWorkloadDatabaseUrl(templateUrl, workloadUrl) {
  const template = new URL(templateUrl);
  const workload = new URL(workloadUrl);
  let login = decodedUrlPart(workload.username, "workload database username");
  if (sharedPoolerHost.test(template.hostname)) {
    const templateLogin = decodedUrlPart(template.username, "template database username");
    const separator = templateLogin.indexOf(".");
    if (separator < 1 || separator === templateLogin.length - 1) {
      throw new Error("Shared Supabase pooler username is missing its project reference");
    }
    const suffix = templateLogin.slice(separator);
    if (login.endsWith(suffix)) login = login.slice(0, -suffix.length);
  }
  const password = decodedUrlPart(workload.password, "workload database password");
  return databaseUrlForLogin(templateUrl, login, password);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const templateUrl = process.env.DATABASE_URL_INPUT;
  if (!templateUrl) throw new Error("DATABASE_URL_INPUT is required");
  if (process.argv[2] === "--normalize") {
    const workloadUrl = process.env.WORKLOAD_DATABASE_URL_INPUT;
    if (!workloadUrl) throw new Error("WORKLOAD_DATABASE_URL_INPUT is required");
    process.stdout.write(normalizeWorkloadDatabaseUrl(templateUrl, workloadUrl));
  } else {
    const login = process.env.LOGIN_INPUT;
    const password = process.env.PASSWORD_INPUT;
    if (!login || !password) throw new Error("LOGIN_INPUT and PASSWORD_INPUT are required");
    process.stdout.write(databaseUrlForLogin(templateUrl, login, password));
  }
}
