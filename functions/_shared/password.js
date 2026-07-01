/** Password hashing via Web Crypto PBKDF2 (Workers + browser compatible). */

export const PBKDF2_ITERATIONS = 600000;

function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex) {
  const value = String(hex || "");
  const out = new Uint8Array(value.length / 2);
  for (let i = 0; i < out.length; i++)
    out[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function pbkdf2Sha256(password, saltBytes, iterations) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: saltBytes, iterations, hash: "SHA-256" },
    key,
    256,
  );
  return bytesToHex(new Uint8Array(bits));
}

export async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(hash));
}

export async function hashPasswordPlain(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2Sha256(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToHex(salt)}$${hash}`;
}

export async function verifyPassword(password, stored) {
  const value = String(stored || "");
  const parts = value.split("$");
  if (parts[0] === "pbkdf2" && parts.length === 4) {
    const iterations = parseInt(parts[1], 10);
    if (!iterations || iterations < 100000) return false;
    const hash = await pbkdf2Sha256(password, hexToBytes(parts[2]), iterations);
    return hash === parts[3];
  }
  if (parts.length === 3 && parts[0] === "sha256") {
    return (await sha256Hex(parts[1] + password)) === parts[2];
  }
  return value === password;
}

export function isLegacySha256Hash(stored) {
  return String(stored || "").startsWith("sha256$");
}
