/**
 * A founder ask (how the request phrases it), the expertise phrases directory records use for it, and
 * the cues an intro email must mention.
 */
interface Topic {
  ask: string;
  phrases: string[];
  cues: string[];
}

/**
 * Topics shared by the peer search and intro drafting tasks. The phrases differ from the ask on
 * purpose so keyword matching on the request text misses.
 */
export const TOPICS: Topic[] = [
  {
    ask: "moving to usage-based pricing",
    cues: ["pricing", "billing"],
    phrases: ["pricing change", "moved to consumption pricing", "metered billing rollout", "usage-based pricing"],
  },
  {
    ask: "landing the first enterprise deals",
    cues: ["enterprise"],
    phrases: [
      "enterprise sales",
      "first enterprise deals",
      "enterprise procurement",
      "security questionnaires for enterprise",
    ],
  },
  {
    ask: "a cofounder leaving",
    cues: ["cofounder", "co-founder"],
    phrases: ["cofounder transition", "cofounder exit", "cofounder equity renegotiation", "founder breakup"],
  },
  {
    ask: "getting SOC 2 done",
    cues: ["soc 2", "soc2", "compliance"],
    phrases: ["SOC 2", "SOC 2 audit", "compliance program", "type 2 audit"],
  },
  {
    ask: "hiring the first ten engineers",
    cues: ["hiring", "engineers"],
    phrases: ["hiring engineers", "engineering hiring loop", "hiring the first ten engineers", "early eng team"],
  },
];
