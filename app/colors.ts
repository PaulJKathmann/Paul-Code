const enabled = !process.env.NO_COLOR && !!process.stdout.isTTY;

function wrap(code: number, text: string): string {
  if (!enabled) return text;
  return `\x1b[${code}m${text}\x1b[0m`;
}

export function red(t: string): string {
  return wrap(31, t);
}
export function green(t: string): string {
  return wrap(32, t);
}
export function yellow(t: string): string {
  return wrap(33, t);
}
export function cyan(t: string): string {
  return wrap(36, t);
}
export function bold(t: string): string {
  return wrap(1, t);
}
export function dim(t: string): string {
  return wrap(2, t);
}
