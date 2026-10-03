import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
    "password", "passwordHash", "secret", "token", "csrfToken",
    "req.body", "body", "err", "error", "*.password", "*.passwordHash", "*.token", "*.secret",
    "appSecret", "app_secret", "accessToken", "access_token", "refreshToken", "refresh_token",
    "*.appSecret", "*.app_secret", "*.accessToken", "*.access_token", "*.refreshToken", "*.refresh_token",
    "encryptedTokens", "*.encryptedTokens", "code", "state",
  ],
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
