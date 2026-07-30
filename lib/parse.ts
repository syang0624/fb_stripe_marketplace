export function extractJsonObject<T>(text: string): T | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    return null;
  }
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return null;
  }
}

export function extractJsonArray<T>(text: string): T[] | null {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) {
    return null;
  }
  try {
    return JSON.parse(match[0]) as T[];
  } catch {
    return null;
  }
}
