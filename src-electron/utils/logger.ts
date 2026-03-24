export function log(message: string): void {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
}
