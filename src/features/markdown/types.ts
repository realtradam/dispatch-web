import type { TextFileContextResponse, TextFileResponse } from "@dispatch/transport-contract";

export type TextFileState =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly file: TextFileResponse };
export interface TextFileClient {
  subscribe(path: string, listener: (state: TextFileState) => void): () => void;
  /** Refresh context as well as the live on-disk file. */
  refresh(path: string): void;
  dispose(): void;
}
export type TextFileContext = TextFileContextResponse;
