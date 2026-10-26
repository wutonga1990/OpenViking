import { compileInputFilters } from "./input-filters.mjs";

export function sanitizeOpenVikingPeerId(raw) {
  const normalized = raw?.trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  return normalized || undefined;
}

export function resolveOpenVikingMessagePeerId(params) {
  if (params.peerRole === "sender" && params.role === "user") return params.senderPeerId;
  if (params.peerRole === "assistant" && params.role === "assistant") return params.assistantPeerId;
  return undefined;
}

export function resolveOpenVikingActorPeerId(params) {
  const actorPeerId = resolveOpenVikingMessagePeerId({
    ...params,
    role: params.peerRole === "sender" ? "user" : "assistant",
  });
  if (params.peerRole === "sender" && !actorPeerId) {
    params.warn?.("openviking: peer_role=sender but no sender identity; " +
      "continuing as an unscoped request under this user (without an actor peer)");
  }
  return actorPeerId;
}

/** Run on the original prompt, before capture/query filters remove its envelope. */
export function extractSenderPeerId(text, cfg = {}) {
  const compiled = compileInputFilters(cfg.captureSenderFilters);
  for (const rule of compiled.rules) {
    if (rule.op !== "s" || (rule.scope && rule.scope !== "user")) continue;
    rule.re.lastIndex = 0;
    if (!rule.re.test(text || "")) continue;
    rule.re.lastIndex = 0;
    return sanitizeOpenVikingPeerId(String(text || "").replace(rule.re, rule.replacement));
  }
  return undefined;
}

export function resolveCapturePeerId(turn, cfg, workspacePeerId = "") {
  if (cfg.peerRole !== "sender") return workspacePeerId || undefined;
  const senderPeerId = (turn.senderPeerId ?? extractSenderPeerId(turn.text, cfg)) || undefined;
  return resolveOpenVikingMessagePeerId({
    peerRole: "sender", role: turn.role,
    senderPeerId: senderPeerId && senderPeerId === cfg.ownerSenderId ? undefined : senderPeerId,
  });
}

export function resolveRecallPeer(prompt, cfg, workspacePeer, warn) {
  if (cfg.peerRole !== "sender") return workspacePeer;
  const senderPeerId = extractSenderPeerId(prompt, cfg);
  const isOwner = Boolean(senderPeerId && senderPeerId === cfg.ownerSenderId);
  return {
    peerId: isOwner ? "" : resolveOpenVikingActorPeerId({
      peerRole: "sender", senderPeerId, warn,
    }) || "",
    legacyPeerId: "", source: "sender",
  };
}
