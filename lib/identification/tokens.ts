const encoder = new TextEncoder();
const b64 = (bytes: Uint8Array) => {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const decodeB64 = (value: string) => {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return new TextDecoder().decode(Uint8Array.from(atob(base64), (character) => character.charCodeAt(0)));
};

async function signature(payload: string, configuredSecret?: string) {
  const secret = configuredSecret ?? process.env.CONFIRMATION_TOKEN_SECRET;
  if (!secret || secret.length < 16) throw new Error("Confirmation token secret is not configured");
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload))));
}

export async function issueConfirmationToken(secret?: string) {
  const payload = b64(encoder.encode(JSON.stringify({ nonce: crypto.randomUUID(), exp: Date.now() + 15 * 60_000 })));
  return `${payload}.${await signature(payload, secret)}`;
}

export async function verifyConfirmationToken(token: string, secret?: string) {
  const [payload, supplied] = token.split(".");
  if (!payload || !supplied || await signature(payload, secret) !== supplied) throw new Error("Invalid confirmation token");
  const data = JSON.parse(decodeB64(payload)) as { nonce: string; exp: number };
  if (!data.nonce || data.exp < Date.now()) throw new Error("Confirmation token expired");
  return data;
}
