import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getFaq,
  seedFaqs,
  DEFAULT_FAQ,
  type FaqCategory,
} from "../src/lib/faq";

function createMockKv() {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string): Promise<string | null> => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string): Promise<void> => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string): Promise<void> => {
      store.delete(key);
    }),
    list: vi.fn(async (): Promise<{ keys: { name: string }[]; list_complete: boolean }> => ({
      keys: [...store.keys()].map((name) => ({ name })),
      list_complete: true,
    })),
    _store: store,
  };
}

describe("FAQ helpers", () => {
  let kv: ReturnType<typeof createMockKv>;

  beforeEach(() => {
    kv = createMockKv();
  });

  describe("getFaq", () => {
    it("returns KV value when present for hours", async () => {
      kv._store.set("faq/hours", "Custom hours text");

      const result = await getFaq(kv, "hours");

      expect(result.found).toBe(true);
      expect(result.content).toBe("Custom hours text");
    });

    it("falls back to default when KV key is missing", async () => {
      const result = await getFaq(kv, "location");

      expect(result.found).toBe(true);
      expect(result.content).toBe(DEFAULT_FAQ.location);
    });

    it("returns default for services category when KV is empty", async () => {
      const result = await getFaq(kv, "services");

      expect(result.found).toBe(true);
      expect(result.content).toBe(DEFAULT_FAQ.services);
    });

    it("returns default for fees category when KV is empty", async () => {
      const result = await getFaq(kv, "fees");

      expect(result.found).toBe(true);
      expect(result.content).toBe(DEFAULT_FAQ.fees);
    });

    it("returns found=false for an unknown category", async () => {
      const result = await getFaq(kv, "insurance");

      expect(result.found).toBe(false);
      expect(result.category).toBe("insurance");
      expect(result.content).toBe("");
    });

    it("returns found=false for empty category", async () => {
      const result = await getFaq(kv, "");

      expect(result.found).toBe(false);
    });
  });

  describe("seedFaqs", () => {
    it("writes all four categories to KV", async () => {
      await seedFaqs(kv);

      expect(kv.put).toHaveBeenCalledTimes(4);
      expect(kv.put).toHaveBeenCalledWith("faq/hours", DEFAULT_FAQ.hours);
      expect(kv.put).toHaveBeenCalledWith("faq/location", DEFAULT_FAQ.location);
      expect(kv.put).toHaveBeenCalledWith("faq/services", DEFAULT_FAQ.services);
      expect(kv.put).toHaveBeenCalledWith("faq/fees", DEFAULT_FAQ.fees);
    });

    it("after seeding, getFaq returns KV values for all categories", async () => {
      await seedFaqs(kv);

      for (const cat of ["hours", "location", "services", "fees"] as FaqCategory[]) {
        const result = await getFaq(kv, cat);
        expect(result.found).toBe(true);
        expect(result.content).toBe(DEFAULT_FAQ[cat]);
      }
    });
  });
});
