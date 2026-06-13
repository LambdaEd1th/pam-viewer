/// <reference types="vite/client" />

declare module '*pam_codec.js' {
  export default function init(): Promise<unknown> | unknown;
  export function decodePam(bytes: Uint8Array): unknown;
  export function encodePam(value: unknown): Uint8Array;
  export function pamToJson(value: unknown): string;
}
