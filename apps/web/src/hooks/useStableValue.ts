import { useRef } from "react";

export function useStableValue<T>(value: T, isEqual: (previous: T, next: T) => boolean): T {
  const cacheRef = useRef(value);
  if (cacheRef.current !== value && !isEqual(cacheRef.current, value)) {
    cacheRef.current = value;
  }
  return cacheRef.current;
}
