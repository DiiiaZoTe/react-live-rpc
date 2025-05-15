import sha256 from 'crypto-js/sha256';

export function stableStringify(obj: unknown): string {
  if (obj === undefined || obj === null) return '{}';
  return JSON.stringify(obj, (key, value) =>
    typeof value === 'object' && value !== null
      ? Object.keys(value)
        .sort()
        .reduce((sortedObj, key) => {
          sortedObj[key] = value[key];
          return sortedObj;
        }, {} as Record<string, unknown>)
      : value
  );
}



export function getRpcChannelName(query: string, params: Record<string, unknown> | undefined): string {
  const paramsHash = sha256(stableStringify(params ?? {})).toString();
  return `query_${query}_${paramsHash}`;
}