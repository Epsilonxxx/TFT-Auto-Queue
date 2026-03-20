type LogListener = (line: string) => void;

const LOG_LIMIT = 50;
const listeners = new Set<LogListener>();
const history: string[] = [];

export function log(message: string): void {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  history.push(line);
  if (history.length > LOG_LIMIT) {
    history.splice(0, history.length - LOG_LIMIT);
  }
  for (const listener of listeners) {
    listener(line);
  }
}

export function onLog(listener: LogListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getLogHistory(): string[] {
  return [...history];
}
