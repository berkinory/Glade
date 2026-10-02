export function isSupportedLocalVideoPath(filePath: string): boolean {
  return /\.(?:mp4|m4v|mov|webm|ogv)$/i.test(filePath);
}
