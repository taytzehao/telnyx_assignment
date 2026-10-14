/**
 * Composed instruction source for the simulated callers in eval scenarios.
 *
 * Mirrors `workflow/prompts.ts`: a scenario's `instructions` is a list of
 * `@scenario:<name>` markers and/or plain strings, resolved and joined into
 * the single string the Telnyx test runner receives. Shared text lives here
 * once instead of being repeated across scenarios, and seeded appointments
 * are described from the same data the runner seeds — so the caller's story
 * and the actor state can't drift apart.
 */
import type { SeedAppointment, TestScenario } from "./types";

/** A seeded appointment plus how the simulated caller refers to it. */
export interface NamedSeed extends SeedAppointment {
  spoken: string;
}

/** Every appointment a scenario can seed, defined once. */
export const SEEDS = {
  jan15: { date: "2027-01-15", start_time: "10:00", spoken: "January 15th, 2027 at 10 AM" },
  jan20: { date: "2027-01-20", start_time: "11:00", spoken: "January 20th, 2027 at 11 AM" },
  jun10: { date: "2027-06-10", start_time: "10:00", spoken: "June 10, 2027 at 10 AM" },
} satisfies Record<string, NamedSeed>;

/** Marker prefix for a composed scenario fragment. */
export const SCENARIO_MARKER_PREFIX = "@scenario:";

/** Fragments shared across scenarios, addressable as `@scenario:<name>`. */
export const SCENARIO_FRAGMENTS: Record<string, string> = {
  caller_role: "You are a caller to ACME Clinic.",
  /**
   * On chat channels a workflow step only acts after the caller's next
   * message (LLM edges are evaluated after the reply), so the simulated
   * caller has to keep the conversation moving: confirm when the assistant
   * checks its understanding, and acknowledge when it says it is working on
   * something.
   */
  keep_conversation_moving:
    "If the assistant only checks what you want (for example, \"You'd like to book an appointment — is that right?\"), say yes. If the assistant says it is checking or looking something up, reply: \"Okay, thanks.\"",
};

/** Name of the per-scenario fragment generated from `seed_appointments`. */
const SEEDED_APPOINTMENTS = "seeded_appointments";

const COUNT_WORDS = ["zero", "one", "two", "three", "four", "five"];

function describeSeeds(seeds: NamedSeed[]): string {
  if (seeds.length === 1) return `You have an appointment on ${seeds[0].spoken}.`;
  const spoken = seeds.map((s) => s.spoken);
  const list = `${spoken.slice(0, -1).join(", ")} and ${spoken[spoken.length - 1]}`;
  return `You have ${COUNT_WORDS[seeds.length] ?? seeds.length} appointments: ${list}.`;
}

/**
 * Resolve composable scenario instructions into the caller's instruction text.
 *
 * `@scenario:seeded_appointments` describes the scenario's own seeds; a
 * scenario that keeps its seeds secret from the caller (e.g. to provoke a
 * conflict) simply leaves the marker out.
 *
 * @throws on an unknown marker, or `@scenario:seeded_appointments` with no
 *   seeds — the same drift guardrail as `@prompt:` markers.
 */
export function composeScenarioInstructions(
  parts: string | string[],
  seeds: NamedSeed[] = [],
): string {
  return (Array.isArray(parts) ? parts : [parts])
    .map((part) => {
      if (!part.startsWith(SCENARIO_MARKER_PREFIX)) return part;
      const name = part.slice(SCENARIO_MARKER_PREFIX.length);
      if (name === SEEDED_APPOINTMENTS) {
        if (seeds.length === 0) {
          throw new Error(`"${part}" is used, but the scenario has no seed_appointments.`);
        }
        return describeSeeds(seeds);
      }
      const fragment = SCENARIO_FRAGMENTS[name];
      if (fragment === undefined) {
        throw new Error(
          `Unknown scenario marker "${part}". Add "${name}" to SCENARIO_FRAGMENTS in workflow/eval/scenario-prompts.ts.`,
        );
      }
      return fragment;
    })
    .filter((part) => part.length > 0)
    .join(" ");
}

/** A scenario in authoring form: composable instructions and named seeds. */
export interface ScenarioSpec
  extends Omit<TestScenario, "instructions" | "seed_appointments"> {
  instructions: string | string[];
  seed_appointments?: NamedSeed[];
}

/** Resolve a scenario spec into the `TestScenario` the runner sends to Telnyx. */
export function defineScenario(spec: ScenarioSpec): TestScenario {
  const { instructions, seed_appointments, ...rest } = spec;
  return {
    ...rest,
    instructions: composeScenarioInstructions(instructions, seed_appointments),
    ...(seed_appointments && {
      seed_appointments: seed_appointments.map(({ date, start_time }) => ({ date, start_time })),
    }),
  };
}
