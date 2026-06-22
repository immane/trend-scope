export function dateDesc(a?: string | null, b?: string | null) {
  const left = a ? Date.parse(a) : 0;
  const right = b ? Date.parse(b) : 0;
  return (Number.isFinite(right) ? right : 0) - (Number.isFinite(left) ? left : 0);
}

export function sortByDateDesc<T>(items: T[], getDate: (item: T) => string | null | undefined) {
  return [...items].sort((a, b) => dateDesc(getDate(a), getDate(b)));
}
