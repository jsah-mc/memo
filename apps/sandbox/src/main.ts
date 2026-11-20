import os from 'node:os';
import type { Readable, Writable } from 'node:stream';
import type { ContainerRequest } from '@microsoft/mxc-sdk/v1';
import { parseArgs } from 'node:util';

// Git/MSYS ships a GNU whoami.exe that shadows System32's. The MXC SDK
// probes identity with `whoami /user`, which fails under the GNU version
// and crashes backend init — put the Windows dirs first.
function prioritizeWindowsPath(): void {
  const pathKey = Object.keys(process.env).find(
    (key) => key.toLowerCase() === 'path',
  );
  if (!pathKey) return;
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
  const windowsDirs = [
    `${systemRoot}\\System32`,
    `${systemRoot}\\System32\\Wbem`,
    systemRoot,
  ];
  const entries = (process.env[pathKey] ?? '')
    .split(';')
    .filter(Boolean)
    .filter((entry) => !windowsDirs.includes(entry));
  process.env[pathKey] = [...windowsDirs, ...entries].join(';');
}

let MxcErrorClass: (new (...args: never[]) => Error) | null = null;

async function forward(
  stream: Readable | null,
  destination: Writable,
): Promise<void> {
  if (stream === null) {
    return Promise.reject(
      new Error('The selected backend did not provide an expected output stream.'),
    );
  }
  return new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => destination.write(chunk));
    stream.once('end', resolve);
    stream.once('error', reject);
  });
}

type CommandProps = {
  command: string;
  stdin?: Readable;
  stdout?: Writable;
  stderr?: Writable;
  timeoutMs: number;
};

async function runSandbox(
  props: CommandProps,
  containment: ContainerRequest['containment'],
): Promise<number> {
  const { spawn, MxcError } = await import('@microsoft/mxc-sdk/v1');
  MxcErrorClass = MxcError as unknown as new (...args: never[]) => Error;

  const request: ContainerRequest = {
    command: props.command,
    containment,
    network: {
      egress: { default: 'allow' },
      ingress: { default: 'allow', hostLoopback: 'allow' },
    },
    timeoutMs: props.timeoutMs,
  };

  const containerProcess = await spawn(request);

  try {
    if (props.stdin && containerProcess.standardInput) {
      props.stdin.pipe(containerProcess.standardInput);
    }
    const stdout = forward(
      containerProcess.standardOutput,
      props.stdout ?? process.stdout,
    );
    const stderr = forward(
      containerProcess.standardError,
      props.stderr ?? process.stderr,
    );
    const result = await containerProcess.wait();
    await Promise.all([stdout, stderr]);

    for (const warning of containerProcess.warnings) {
      console.error(`warning: ${warning}`);
    }

    if (result.timedOut) {
      console.error('workload timed out');
      return 124;
    }
    return result.exitCode;
  } finally {
    containerProcess.dispose();
  }
}

const currentOS: string = os.platform();

// pnpm injects a literal "--" before forwarded args; parseArgs treats it
// as end-of-options, so strip it first.
const args = process.argv
  .slice(2)
  .filter((arg, index) => !(arg === '--' && index === 0));

const { values, positionals } = parseArgs({
  args,
  options: {
    command: {
      type: 'string',
      short: 'c'
    },
    timeout: {
      type: 'string',
      short: 't',
      default: '30000',
    },
  },
  allowPositionals: true,
});

const command =
  values.command ?? (positionals.length ? positionals.join(' ') : '');

try {
  if (currentOS === 'win32') {
    prioritizeWindowsPath();
  }
  if (currentOS === 'win32') {
    if (!command) {
      console.error('usage: pnpm dev -- -c "<command>" [-t <timeoutMs>]');
      process.exitCode = 2;
    } else {
      process.exitCode = await runSandbox(
        { command, timeoutMs: parseInt(values.timeout, 10) },
        { type: 'isolation_session' },
      );
    }
  } else if (currentOS === 'darwin') {
    if (!command) {
      console.error('usage: pnpm dev -- -c "<command>" [-t <timeoutMs>]');
      process.exitCode = 2;
    } else {
      process.exitCode = await runSandbox(
        { command, timeoutMs: parseInt(values.timeout, 10) },
        { type: 'seatbelt' },
      );
    }
  } else if (currentOS === 'linux') {
    if (!command) {
      console.error('usage: pnpm dev -- -c "<command>" [-t <timeoutMs>]');
      process.exitCode = 2;
    } else {
      process.exitCode = await runSandbox(
        { command, timeoutMs: parseInt(values.timeout, 10) },
        { type: 'bubblewrap' },
      );
    }
  } else {
    console.log('Sorry Memo Sandbox does not support this OS yet.');
  }
} catch (error) {
  if (MxcErrorClass && error instanceof MxcErrorClass) {
    const mxc = error as Error & { code?: string };
    console.error(`MXC error [${mxc.code}]: ${mxc.message}`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
}
