import { TIERS, queueSize } from "../lib/api";
import { usePolled } from "../lib/hooks";

const FEATURES = [
  {
    glyph: "⚖️",
    title: "Same questions, same order",
    body: "One seed generates the whole set, so both players face an identical run. The only variable is you.",
  },
  {
    glyph: "⏱",
    title: "Two minutes, twenty questions",
    body: "Solve time is measured from the moment the server serves a question, minus half your ping. Latency doesn't decide matches.",
  },
  {
    glyph: "📈",
    title: "Glicko-2 rating",
    body: "Every result moves your rating and its uncertainty. Your tier — beginner, intermediate, advanced — follows from it.",
  },
];

export default function Landing({
  onSignIn, error, busy,
}: {
  onSignIn: () => void;
  error: string | null;
  busy: boolean;
}) {
  const { data: queues } = usePolled(
    () => Promise.all(TIERS.map((t) => queueSize(t))),
    [],
    10_000,
  );
  const waiting = queues?.reduce((n, q) => n + q.waiting, 0) ?? null;

  return (
    <div className="page middle">
      <section className="hero rise">
        <span className="eyebrow">
          <i className={`dot ${waiting === null ? "" : "on"}`} />
          {waiting === null ? "checking the lobby…" : `${waiting} player${waiting === 1 ? "" : "s"} in the queue right now`}
        </span>

        <h1>
          Mental arithmetic,
          <br />
          as a duel.
        </h1>
        <p className="lede">
          Two players. Twenty questions. The same twenty, in the same order — first
          past the post on accuracy, then on genuine solve time.
        </p>

        <button className="btn primary big" onClick={onSignIn} disabled={busy}>
          {busy ? "Opening Google…" : "Sign in with Google"}
        </button>

        {error && <p className="banner bad">{error}</p>}
      </section>

      <section className="features">
        {FEATURES.map((f) => (
          <div className="panel feature rise" key={f.title}>
            <span className="glyph" aria-hidden="true">{f.glyph}</span>
            <h3>{f.title}</h3>
            <p>{f.body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
