export function logTime(message: string) {
  console.log(`[${performance.now() * 0.001}] ${message}`);
}
