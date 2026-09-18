import type { Fixture } from "../../core/types.ts";
import type { IntroKey } from "./generate.ts";

/**
 * Reference answer from the key: a skipped entry for each blocked target and a short compliant email for the
 * rest.
 */
export function gold(f: Fixture<IntroKey>): Record<string, string> {
  const k = f.key;
  return {
    "output/intros.json": JSON.stringify(
      k.targets.map((t) =>
        t.blocked
          ? { to: t.name, skipped: true, reason: "on do-not-contact.csv" }
          : {
              to: t.name,
              subject: `Open to an intro to ${k.requester} (${k.requesterCompany})?`,
              body: `Hi ${t.name.split(" ")[0]},\n\nCongratulations on having ${t.milestone}. Would you be open to an intro to ${k.requester}? ${k.requester} runs ${k.requesterCompany} and is heading into ${k.topic}, which you went through at ${t.company}.\n\nIf yes, I will connect you both.\n\nThanks,\nThe Lumen team`,
            },
      ),
    ),
  };
}
