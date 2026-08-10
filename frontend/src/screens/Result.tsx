import { standing, type Me, type Tier } from "../lib/api";
import { usePolled } from "../lib/hooks";
import { accuracy, type DuelState } from "../lib/duel";
import { ordinal, secs } from "../lib/format";
import type { ServerMsg } from "../lib/socket";

type End = Extract<ServerMsg, { t: "end" }>;

export default function Result({
  end, duel, me, onAgain, onHome, onBoard,
}: {
  end: End;
  duel: DuelState;
  me: Me | null;
  onAgain: () => void;
  onHome: () => void;
  onBoard: () => void;
}) {
  const [mine, theirs] = end.score;
  const verdict = end.winner === "you" ? "You won" : end.winner === "them" ? "You lost" : "Draw";
  const delta = end.ratingDelta;

  // The board is updated as part of finalisation, so this can land a moment
  // late. Polling briefly is honest about that instead of showing a stale rank.
  const tier = (duel.tier || "intermediate") as Tier;
  const rank = usePolled(
    () => (me ? standing(tier, me.id) : Promise.resolve(null)),
    [me?.id, tier],
    5000,
  );

  const solves = duel.solveMs.filter((n) => n > 0);
  const fastest = solves.length ? Math.min(...solves) : 0;
  const average = solves.length ? solves.reduce((a, b) => a + b, 0) / solves.length : 0;

  return (
    <div className="page narrow middle">
      <section className="panel result rise">
        <span className="upper">{duel.tier || "duel"} · final</span>
        <h2 className={`verdict ${end.winner}`}>{verdict}</h2>

        <div className="final-score">
          <span className="mine">{mine}</span>
          <span className="sep">vs</span>
          <span className="theirs">{theirs}</span>
        </div>
        <p className="dim">against {duel.opponent || "your opponent"}</p>

        <div className={`delta ${delta > 0 ? "up" : delta < 0 ? "down" : ""}`}>
          {delta > 0 ? "+" : ""}{delta} rating
        </div>
        <p className="small faint" style={{ maxWidth: "44ch" }}>
          {Math.abs(delta) > 100
            ? "A big move — Glicko-2 is still unsure how good you are, so it trusts this result heavily."
            : "A small move — your rating deviation has settled, so each result nudges rather than shoves."}
        </p>

        <div className="stats">
          <div className="stat">
            <b>{duel.yourScore}/{duel.answered || 0}</b>
            <span>correct</span>
          </div>
          <div className="stat">
            <b>{Math.round(accuracy(duel) * 100)}%</b>
            <span>accuracy</span>
          </div>
          <div className="stat">
            <b>{fastest ? secs(fastest) : "—"}</b>
            <span>fastest</span>
          </div>
          <div className="stat">
            <b>{average ? secs(average) : "—"}</b>
            <span>average</span>
          </div>
        </div>

        <div className="banner info" style={{ width: "100%", justifyContent: "center" }}>
          {rank.loading && "updating your position…"}
          {!rank.loading && rank.data && (
            <span>
              You are now <b>{ordinal(rank.data.rank)}</b> of {rank.data.of} in {tier} with{" "}
              <b>{Math.round(rank.data.points)}</b> ladder points.
            </span>
          )}
          {!rank.loading && !rank.data && "You are not on this board yet."}
        </div>

        <div className="row gap-s wrap center">
          <button className="btn primary" onClick={onAgain}>Play again</button>
          <button className="btn" onClick={onBoard}>Leaderboard</button>
          <button className="btn ghost" onClick={onHome}>Home</button>
        </div>
      </section>
    </div>
  );
}
