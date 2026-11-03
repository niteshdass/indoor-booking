import { useCallback, useEffect, useState } from 'react';
import { STEPS, type Answers, type Step } from './answers';

type Draft = { answers: Answers; step: Step };

function read(key: string, fallback: Draft): Draft {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const saved = JSON.parse(raw) as Partial<Draft>;
    // Fields added since the draft was saved take their defaults.
    return {
      answers: { ...fallback.answers, ...saved.answers },
      step: STEPS.includes(saved.step as Step) ? (saved.step as Step) : fallback.step,
    };
  } catch {
    return fallback;
  }
}

/**
 * The setup answers and current step, kept in this browser as they change, so a closed tab or a dropped
 * connection does not lose them. `clear` forgets them once the venue is created.
 */
export function useDraft(key: string, initial: Answers) {
  const [draft, setDraft] = useState<Draft>(() => read(key, { answers: initial, step: STEPS[0] }));

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(draft));
    } catch {
      // Private mode or full storage: the setup still works, it just is not remembered.
    }
  }, [key, draft]);

  const update = useCallback((patch: Partial<Answers>) => setDraft((d) => ({ ...d, answers: { ...d.answers, ...patch } })), []);
  const goTo = useCallback((step: Step) => setDraft((d) => ({ ...d, step })), []);
  const clear = useCallback(() => {
    try {
      localStorage.removeItem(key);
    } catch {
      // nothing saved to forget
    }
  }, [key]);

  return { answers: draft.answers, step: draft.step, update, goTo, clear };
}
