// Prefixed, sortable-ish IDs (readable in URLs, easy to scan in DB browser).
export function newId(prefix: string): string {
  const rand = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
  return `${prefix}_${rand}`;
}
