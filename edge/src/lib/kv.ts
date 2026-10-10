import type { KvNamespace } from "@telnyx/edge-runtime";

/** Read a feature flag value from KV. Returns `defaultValue` if unset. */
export async function getFlag(
  kv: KvNamespace,
  name: string,
  defaultValue = "false",
): Promise<string> {
  return (await kv.get(name)) ?? defaultValue;
}

/** Read and deserialize a cached JSON value from KV. */
export async function getCached<T>(
  kv: KvNamespace,
  key: string,
): Promise<T | null> {
  const raw = await kv.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Serialize and store a value in KV. */
export async function setCached<T>(
  kv: KvNamespace,
  key: string,
  value: T,
): Promise<void> {
  await kv.put(key, JSON.stringify(value));
}
