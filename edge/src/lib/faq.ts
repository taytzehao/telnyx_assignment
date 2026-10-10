import type { KvNamespace } from "@telnyx/edge-runtime";

export type FaqCategory = "hours" | "location" | "services" | "fees";

const VALID_CATEGORIES: FaqCategory[] = ["hours", "location", "services", "fees"];

const DEFAULT_FAQ: Record<FaqCategory, string> = {
  hours:
    "ACME Clinic is open Monday through Friday, 9 AM to 5 PM. We are closed on weekends and public holidays.",
  location:
    "ACME Clinic is located at 123 Health Street, Suite 200, Springfield. Free parking is available in the building garage.",
  services:
    "ACME Clinic offers general practice, preventative care, vaccinations, lab testing, and chronic disease management. We also provide telehealth appointments.",
  fees:
    "A standard consultation is $120. Lab tests are billed separately starting at $40. We accept most major insurance plans. Please call our billing line for specific coverage questions.",
};

function isCategory(value: string): value is FaqCategory {
  return (VALID_CATEGORIES as string[]).includes(value);
}

export function kvKey(category: FaqCategory): string {
  return `faq/${category}`;
}

export async function seedFaqs(kv: KvNamespace): Promise<void> {
  await kv.put(kvKey("hours"), DEFAULT_FAQ.hours);
  await kv.put(kvKey("location"), DEFAULT_FAQ.location);
  await kv.put(kvKey("services"), DEFAULT_FAQ.services);
  await kv.put(kvKey("fees"), DEFAULT_FAQ.fees);
}

export interface FaqResult {
  found: boolean;
  category: string;
  content: string;
}

export async function getFaq(
  kv: KvNamespace,
  category: string,
): Promise<FaqResult> {
  if (!isCategory(category)) {
    return {
      found: false,
      category,
      content: "",
    };
  }

  const cached = await kv.get(kvKey(category));
  if (cached) {
    return { found: true, category, content: cached };
  }

  return { found: true, category, content: DEFAULT_FAQ[category] };
}

export { DEFAULT_FAQ };
