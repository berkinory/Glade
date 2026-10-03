export function downloadDisposition(filename: string): string {
  const name =
    Array.from(filename, (character) => {
      const code = character.codePointAt(0)!;
      if (code >= 0xd800 && code <= 0xdfff) return "\uFFFD";
      return code < 32 || code === 127 ? "_" : character;
    }).join("") || "download";
  const fallback = Array.from(name, (character) =>
    character.codePointAt(0)! > 126 || character === '"' || character === "\\" ? "_" : character,
  ).join("");
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
