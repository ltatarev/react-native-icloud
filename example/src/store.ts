import {
  createICloudStore,
  type ICloudLogEntry,
} from '@ltatarev/react-native-icloud';

export type LogLine = {
  id: number;
  at: number;
  kind: 'native' | 'action' | 'event';
  text: string;
  isError: boolean;
};

type LogListener = (line: LogLine) => void;

const listeners = new Set<LogListener>();
let nextId = 1;

export function addLogLine(
  kind: LogLine['kind'],
  text: string,
  isError = false,
): void {
  const line: LogLine = { id: nextId++, at: Date.now(), kind, text, isError };
  listeners.forEach(listener => listener(line));
}

export function onLogLine(listener: LogListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function describeNative(entry: ICloudLogEntry): string {
  const parts = [`${entry.operation}`];
  if (entry.name) {
    parts.push(`"${entry.name}"`);
  }
  parts.push(`${entry.durationMs}ms`);
  if (entry.result) {
    parts.push(`→ ${entry.result}`);
  }
  if (entry.code) {
    parts.push(`[${entry.code}] ${entry.message ?? ''}`);
  }
  return parts.join(' ');
}

/**
 * One store for the whole app. The container comes from
 * `ICloudContainerIdentifier` in Info.plist. A short download timeout makes
 * placeholder behavior easy to see.
 */
export const store = createICloudStore({
  downloadTimeoutMs: 10000,
  onLog: entry =>
    addLogLine('native', describeNative(entry), entry.outcome === 'error'),
});
