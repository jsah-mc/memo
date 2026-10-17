import { useEffect, useState } from "react";

const FRAMES = [
  ["+-----------+", "|  o     o  |", "|     _     |", "+-----------+"],
  ["+-----------+", "|  -     -  |", "|     _     |", "+-----------+"],
  ["+-----------+", "|  o     o  |", "|    ___    |", "+-----------+"],
  ["+-----------+", "|  o     o  |", "|     _     |", "+-----------+"],
] as const;

export function AsciiAgent() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setFrame((value) => (value + 1) % FRAMES.length), 520);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div className="ascii-agent" role="img" aria-label="Memo agent ready">
      <div className="ascii-agent-label">memo://agent</div>
      <pre aria-hidden="true">{FRAMES[frame].join("\n")}</pre>
      <div className="ascii-agent-status"><span aria-hidden="true">$</span> ready<span className="terminal-cursor" aria-hidden="true">_</span></div>
    </div>
  );
}
