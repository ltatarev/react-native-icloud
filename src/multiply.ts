// Fallback for every platform except iOS. Metro picks multiply.ios.ts on iOS,
// so the Nitro hybrid object is never created on Android.
export function multiply(_a: number, _b: number): number {
  throw new Error(
    "'@ltatarev/react-native-icloud' is only supported on iOS.",
  );
}
