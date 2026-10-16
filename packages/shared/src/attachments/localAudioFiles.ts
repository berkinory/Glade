export function isSupportedLocalAudioPath(filePath: string): boolean {
  return /\.(?:mp3|m4a|aac|wav|ogg|oga|opus|flac)$/i.test(filePath);
}
