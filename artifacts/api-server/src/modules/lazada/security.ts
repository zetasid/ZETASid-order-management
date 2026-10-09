import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export const nonce = () => randomBytes(32).toString("base64url");
export const validNonce = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);

export type LazadaConfig = {
  appKey: string; appSecret: string; key: Buffer; callback: URL;
  country: keyof typeof endpoints; site: `lazada_${keyof typeof endpoints}`; fingerprint: string;
};
export const endpoints = {
  id: "https://api.lazada.co.id/rest",
  sg: "https://api.lazada.sg/rest",
  my: "https://api.lazada.com.my/rest",
  th: "https://api.lazada.co.th/rest",
  vn: "https://api.lazada.vn/rest",
  ph: "https://api.lazada.com.ph/rest",
} as const;

export function configuration(env: NodeJS.ProcessEnv = process.env): LazadaConfig | null {
  const { LAZADA_APP_KEY: appKey, LAZADA_APP_SECRET: appSecret, LAZADA_TOKEN_ENCRYPTION_KEY: key,
    LAZADA_REDIRECT_URI: callback, LAZADA_MODE: mode } = env;
  const country = env.LAZADA_COUNTRY ?? "id";
  // The app's webhook site can differ from the seller's API endpoint country.
  // Empty/unset keeps the existing country-based default; overrides are exact.
  const site = env.LAZADA_SITE || `lazada_${country}`;
  if (mode !== "testing" || !appKey || !/^\d{1,30}$/.test(appKey) || !appSecret
    || !key || !/^[a-fA-F0-9]{64}$/.test(key) || !callback || !Object.hasOwn(endpoints, country)
    || !Object.keys(endpoints).some(code => site === `lazada_${code}`)) return null;
  try {
    const url = new URL(callback);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash
      || url.pathname !== "/api/lazada/oauth/callback") return null;
    if (env.APP_ORIGIN && url.origin !== new URL(env.APP_ORIGIN).origin) return null;
    return { appKey, appSecret, key: Buffer.from(key, "hex"), callback: url,
      country: country as LazadaConfig["country"], site: site as LazadaConfig["site"],
      fingerprint: hash(`${appKey}:${country}`) };
  } catch { return null; }
}

export function imConfiguration(env: NodeJS.ProcessEnv = process.env): LazadaConfig | null {
  const { LAZADA_IM_APP_KEY: appKey, LAZADA_IM_APP_SECRET: appSecret,
    LAZADA_TOKEN_ENCRYPTION_KEY: key, LAZADA_REDIRECT_URI: callback, LAZADA_MODE: mode } = env;
  const country = env.LAZADA_COUNTRY ?? "id";
  if (mode !== "testing" || !appKey || !/^\d{1,30}$/.test(appKey) || !appSecret
    || !key || !/^[a-fA-F0-9]{64}$/.test(key) || !callback || !Object.hasOwn(endpoints, country)) return null;
  try {
    const url = new URL(callback);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash
      || url.pathname !== "/api/lazada/oauth/callback") return null;
    if (env.APP_ORIGIN && url.origin !== new URL(env.APP_ORIGIN).origin) return null;
    return { appKey, appSecret, key: Buffer.from(key, "hex"), callback: url,
      country: country as LazadaConfig["country"], site: `lazada_${country}` as LazadaConfig["site"],
      fingerprint: hash(`lazada-im:${appKey}:${country}`) };
  } catch { return null; }
}

/**
 * Public IM push is an explicit opt-in for non-production testing only.
 * Merely configuring the separate IM OAuth credentials must not activate callbacks.
 */
export function imPushConfiguration(env: NodeJS.ProcessEnv = process.env): LazadaConfig | null {
  if (env.NODE_ENV === "production" || env.LAZADA_MODE !== "testing"
    || env.LAZADA_IM_PUSH_ENABLED !== "true") return null;
  return imConfiguration(env);
}

export function seal(value: string, config: LazadaConfig, userId: string): string {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", config.key, iv);
  cipher.setAAD(Buffer.from(`lazada:v1:${userId}:${config.fingerprint}`));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}
export function unseal(value: string, config: LazadaConfig, userId: string): string {
  const [version, iv, tag, ciphertext, extra] = value.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext || extra) throw new Error("Invalid encrypted connection");
  const decipher = createDecipheriv("aes-256-gcm", config.key, Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(`lazada:v1:${userId}:${config.fingerprint}`));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

function imMessageContentKey(config: LazadaConfig): Buffer {
  // Domain-separate persisted customer content from OAuth token encryption.
  return createHash("sha256").update("zetas:lazada:im-message-content:v1\u0000", "utf8")
    .update(config.key).digest();
}

export function sealImMessageContent(value: string, config: LazadaConfig, userId: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", imMessageContentKey(config), iv);
  cipher.setAAD(Buffer.from(`lazada-im-message:v1:${userId}:${config.fingerprint}`));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["imc1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url")].join(".");
}

export function unsealImMessageContent(value: string, config: LazadaConfig, userId: string): string {
  const [version, iv, tag, ciphertext, extra] = value.split(".");
  if (version !== "imc1" || !iv || !tag || !ciphertext || extra)
    throw new Error("Invalid encrypted IM message");
  const decipher = createDecipheriv("aes-256-gcm", imMessageContentKey(config), Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(`lazada-im-message:v1:${userId}:${config.fingerprint}`));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}