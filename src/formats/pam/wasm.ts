interface PamCodecWasm {
  decodePam(bytes: Uint8Array): unknown;
  encodePam(value: unknown): Uint8Array;
  pamToJson(value: unknown): string;
}

type PamCodecModule = PamCodecWasm & {
  default: () => Promise<unknown> | unknown;
};

let loadPromise: Promise<PamCodecWasm> | null = null;

export function loadPamCodecWasm(): Promise<PamCodecWasm> {
  loadPromise ??= import('../../wasm/pam-codec/pam_codec.js')
    .then(async (module) => {
      const codec = module as PamCodecModule;
      await codec.default();
      return codec;
    })
    .catch((error) => {
      loadPromise = null;
      throw error;
    });
  return loadPromise;
}
