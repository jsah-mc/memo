import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

type Prerequisite = {
  name: string;
  installed: boolean;
  required: boolean;
  path: string | null;
};

type InstallStatus = {
  installed: boolean;
  app_dir: string;
  version: string | null;
};

type LogLine = { stream: "stdout" | "stderr"; line: string };

const STEPS = [
  "Checking your system",
  "Preparing Memo",
  "Installing dependencies",
  "Almost done",
];

function stepForLine(line: string): number {
  const l = line.toLowerCase();
  if (l.includes("clone") || l.includes("fetch") || l.includes("pull")) return 1;
  if (l.includes("uv sync") || l.includes("pnpm install") || l.includes("installing")) return 2;
  if (l.includes("shortcut") || l.includes("start menu") || l.includes("path")) return 3;
  return -1;
}

export default function App() {
  const [prereqs, setPrereqs] = useState<Prerequisite[] | null>(null);
  const [status, setStatus] = useState<InstallStatus | null>(null);
  const [running, setRunning] = useState(false);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [step, setStep] = useState(0);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    const [p, s] = await Promise.all([
      invoke<Prerequisite[]>("prerequisites"),
      invoke<InstallStatus>("install_status"),
    ]);
    setPrereqs(p);
    setStatus(s);
  }, []);

  useEffect(() => {
    refresh();
    const unlisten = listen<LogLine>("install:output", (e) => {
      setLogs((prev) => [...prev.slice(-500), e.payload]);
      const s = stepForLine(e.payload.line);
      if (s >= 0) setStep(s);
    });
    const unlistenDone = listen<number>("install:done", (e) => {
      setExitCode(e.payload);
      setRunning(false);
      if (e.payload === 0) refresh();
    });
    return () => {
      unlisten.then((f) => f());
      unlistenDone.then((f) => f());
    };
  }, [refresh]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [logs]);

  const missingRequired = prereqs?.filter((p) => p.required && !p.installed) ?? [];
  const canInstall = prereqs !== null && missingRequired.length === 0 && !running;
  const succeeded = exitCode === 0;

  const startInstall = async () => {
    setRunning(true);
    setExitCode(null);
    setStep(0);
    setLogs([]);
    try {
      await invoke<number>("run_install");
    } catch (e) {
      setLogs((prev) => [
        ...prev,
        { stream: "stderr", line: `Installer error: ${e}` },
      ]);
      setRunning(false);
    }
  };

  const launch = (target: string) => invoke("launch_memo", { target });

  return (
    <div className="app">
      <header className="header">
        <div className="logo">// MEMO</div>
        <p className="tagline">Your local agent workspace — desktop, terminal, and gateway.</p>
      </header>

      <section className="card">
        <h2>{status?.installed ? "Update Memo" : "Install Memo"}</h2>
        {status?.installed ? (
          <p className="muted">
            Memo {status.version ?? ""} is already installed at{" "}
            <code>{status.app_dir}</code>. Running the installer will pull the
            latest version and refresh dependencies.
          </p>
        ) : (
          <p className="muted">
            This installs Memo to <code>~/.memo</code>, adds the{" "}
            <code>memo</code> command to your PATH, and creates a Start menu
            shortcut.
          </p>
        )}

        {prereqs && (
          <ul className="prereqs">
            {prereqs.map((p) => (
              <li key={p.name} className={p.installed ? "ok" : p.required ? "bad" : "warn"}>
                <span className="dot" />
                <span className="name">{p.name}</span>
                <span className="detail">
                  {p.installed ? (p.path ?? "found") : p.required ? "required — install Git first" : "will be installed automatically"}
                </span>
              </li>
            ))}
          </ul>
        )}

        {!running && exitCode === null && (
          <button className="primary" disabled={!canInstall} onClick={startInstall}>
            {status?.installed ? "Update Memo" : "Install Memo"}
          </button>
        )}
        {missingRequired.length > 0 && (
          <p className="error">Git is required. Install it from git-scm.com, then reopen this installer.</p>
        )}
      </section>

      {(running || exitCode !== null) && (
        <section className="card">
          <div className="steps">
            {STEPS.map((label, i) => (
              <div key={label} className={`step ${i < step || (succeeded && i <= step) ? "done" : i === step && running ? "active" : ""}`}>
                <span className="step-dot" />
                {label}
              </div>
            ))}
          </div>
          <div className="log" ref={logRef}>
            {logs.map((l, i) => (
              <div key={i} className={l.stream === "stderr" ? "err" : ""}>
                {l.line}
              </div>
            ))}
            {running && <div className="cursor">▌</div>}
          </div>
          {exitCode !== null && (
            <p className={succeeded ? "success" : "error"}>
              {succeeded
                ? "Installation complete. Open a new terminal and run `memo`, or launch below."
                : `Installation failed with exit code ${exitCode}. See the log above.`}
            </p>
          )}
          {succeeded && (
            <div className="launch-row">
              <button className="primary" onClick={() => launch("desktop")}>
                Launch Desktop App
              </button>
              <button onClick={() => launch("tui")}>Launch Terminal UI</button>
              <button onClick={() => launch("gateway")}>Start Gateway</button>
            </div>
          )}
        </section>
      )}

      <footer className="footer">
        Memo installs to ~/.memo · source: github.com/jsah-mc/memo
      </footer>
    </div>
  );
}
