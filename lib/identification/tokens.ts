const encoder = new TextEncoder();
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

async function signature(payload: string) {
  const secret = process.env.CONFIRMATION_TOKEN_SECRET;
  if (!secret || secret.length < 16) throw new Error("Confirmation token secret is not configured");
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload))));
}

export async function issueConfirmationToken() {
  const payload = b64(encoder.encode(JSON.stringify({ nonce: crypto.randomUUID(), exp: Date.now() + 15 * 60_000 })));
  return `${payload}.${await signature(payload)}`;
}

export async function verifyConfirmationToken(token: string) {
  const [payload, supplied] = token.split(".");
  if (!payload || !supplied || await signature(payload) !== supplied) throw new Error("Invalid confirmation token");
  const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as { nonce: string; exp: number };
  if (!data.nonce || data.exp < Date.now()) throw new Error("Confirmation token expired");
  return data;
}
