// GENERATED FROM examples/memory-plugin-shared/lib. DO NOT EDIT.
export function sanitizeOpenVikingPeerId(raw?: string): string | undefined;
export function resolveOpenVikingMessagePeerId(params: {
  peerRole: "none" | "assistant" | "sender"; role?: string;
  senderPeerId?: string; assistantPeerId?: string;
}): string | undefined;
export function resolveOpenVikingActorPeerId(params: {
  peerRole: "none" | "assistant" | "sender"; senderPeerId?: string;
  assistantPeerId?: string; warn?: (message: string) => void;
}): string | undefined;
export function extractSenderPeerId(text: string, cfg?: Record<string, any>): string | undefined;
export function resolveCapturePeerId(turn: any, cfg: Record<string, any>, workspacePeerId?: string): string | undefined;
export function resolveRecallPeer(prompt: string, cfg: Record<string, any>, workspacePeer: any, warn?: (message: string) => void): any;
