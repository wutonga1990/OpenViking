import assert from "node:assert/strict";
import test from "node:test";
import { extractSenderPeerId, resolveCapturePeerId, resolveRecallPeer,
  resolveOpenVikingActorPeerId, resolveOpenVikingMessagePeerId } from "./lib/sender-peer.mjs";
import { extractCaptureTurns as ccTurns } from "../claude-code-memory-plugin/scripts/cc-transcript.mjs";
import { extractCaptureTurns as cxTurns } from "../codex-memory-plugin/scripts/capture-utils.mjs";

const cfg = {
  peerRole: "sender", captureAssistantTurns: true,
  captureSenderFilters: [
    's#^[\\s\\S]*<sender\\b[^>]*name="蔡蔡"[^>]*/>[\\s\\S]*$#person-caicai#',
    's#^[\\s\\S]*<sender\\b[^>]*name="([A-Za-z0-9_-]+)"[^>]*/>[\\s\\S]*$#bot-$1#',
  ],
  captureFilters: ['user:s#^[\\s\\S]*<user_message>([\\s\\S]*?)</user_message>[\\s\\S]*$#$1#'],
};
const prompt = (name, id) => `<user_message>I agree with this plan.</user_message>\n<sender type="user" open_id="${id}" name="${name}" />`;

test("sender mode gives every user a peer, including the authenticated owner", () => {
  assert.equal(resolveCapturePeerId({ role: "user", text: prompt("蔡蔡", "app-a") }, cfg, "project"), "person-caicai");
  assert.equal(resolveCapturePeerId({ role: "user", text: prompt("Claude", "bot-id") }, cfg, "project"), "bot-Claude");
  assert.equal(resolveCapturePeerId({ role: "assistant", text: "My response" }, cfg, "project"), undefined);
  assert.equal(resolveCapturePeerId({ role: "user", text: "Terminal input" }, cfg, "project"), undefined);
  assert.equal(resolveCapturePeerId({ role: "user", text: "Terminal input" }, {}, "project"), "project");
});

test("actor peer uses the same sender, never the previous turn or project", () => {
  const workspace = { peerId: "project", legacyPeerId: "old-project" };
  assert.equal(resolveRecallPeer(prompt("蔡蔡", "app-a"), cfg, workspace).peerId,
    resolveRecallPeer(prompt("蔡蔡", "app-b"), cfg, workspace).peerId);
  assert.deepEqual(resolveRecallPeer(prompt("Claude", "id"), cfg, workspace),
    { peerId: "bot-Claude", legacyPeerId: "", source: "sender" });
  const warnings = [];
  assert.equal(resolveRecallPeer("Terminal input", cfg, workspace, (s) => warnings.push(s)).peerId, "");
  assert.equal(warnings.length, 1);
  assert.equal(resolveRecallPeer("hello", {}, workspace), workspace);
});

test("both host adapters retain sender routing before filters strip the envelope", () => {
  const text = prompt("蔡蔡", "app-a");
  const cc = ccTurns([{ type: "user", message: { role: "user", content: text } }], cfg)[0];
  const cx = cxTurns([{ type: "response_item", payload: {
    type: "message", role: "user", content: [{ type: "input_text", text }],
  }}], cfg)[0];
  assert.ok(cc);
  assert.ok(cx);
  assert.equal(resolveCapturePeerId(cc, cfg, "project"), "person-caicai");
  assert.equal(resolveCapturePeerId(cx, cfg, "project"), "person-caicai");
  assert.equal(cx.parts[0].text, "I agree with this plan.");
});

test("invalid, non-substitution and unmatched rules do not invent a sender", () => {
  assert.equal(extractSenderPeerId("hello", { captureSenderFilters: ['broken', 'd#hello#'] }), undefined);
  assert.equal(extractSenderPeerId("hello", { captureSenderFilters: ['s#nomatch#x#'] }), undefined);
});

test("the shared OpenClaw routing contract remains unchanged", () => {
  for (const role of ["user", "assistant"]) {
    assert.equal(resolveOpenVikingMessagePeerId({ peerRole: "sender", role, senderPeerId: "alice" }),
      role === "user" ? "alice" : undefined);
  }
  assert.equal(resolveOpenVikingActorPeerId({ peerRole: "assistant", assistantPeerId: "agent" }), "agent");
  assert.equal(resolveOpenVikingActorPeerId({ peerRole: "none" }), undefined);
});


test("an optional owner sender stays unpeered for capture and recall", () => {
  const ownerCfg = { ...cfg, ownerSenderId: "person-caicai" };
  const text = prompt("蔡蔡", "different-reader");
  const warnings = [];
  assert.equal(resolveCapturePeerId({role:"user",text}, ownerCfg,"project"), undefined);
  assert.equal(resolveRecallPeer(text, ownerCfg, {peerId:"project"}, (s)=>warnings.push(s)).peerId, "");
  assert.deepEqual(warnings, []);
  assert.equal(resolveCapturePeerId({role:"user",text:prompt("Claude","id")},ownerCfg,"project"), "bot-Claude");
});

import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expectExit, runHookScript, readRequestBody, withMockOpenViking, writeJson } from "./testing/support.mjs";

for (const host of ["claude-code", "codex"]) {
  test(`${host} sends sender peers and the recall actor on the wire`, async () => {
    const root = await mkdtemp(join(tmpdir(), "ov-sender-wire-"));
    const config = join(root, "ovcli.conf");
    const transcript = join(root, "turns.jsonl");
    const batches = [], actors = [];
    const ownerText = prompt("蔡蔡", "app-owner");
    const botText = prompt("Claude", "app-bot");
    try {
      await writeFile(transcript, [
        { role: "user", content: ownerText },
        { role: "assistant", content: "This is my explanation." },
        { role: "user", content: botText },
      ].map(JSON.stringify).join("\n"));
      await withMockOpenViking(async (req, res) => {
        const body = await readRequestBody(req);
        if (req.url.endsWith("/messages/batch")) batches.push(body.messages);
        if (body?.query) actors.push(req.headers["x-openviking-actor-peer"]);
        writeJson(res, {status:"ok", result:{pending_tokens:0, entries:[], rendered:"", stats:{}}});
      }, async (url) => {
        await writeFile(config, JSON.stringify({url,plugin:{...cfg,ownerSenderId:"person-caicai",
          autoCapture:true,autoRecall:true,recallCompress:"off",minQueryLength:1}}));
        const env = { HOME:root, TMPDIR:root, OPENVIKING_HOME:root,
          OPENVIKING_CLI_CONFIG_FILE:config, OPENVIKING_CONFIG_FILE:join(root,"absent"),
          OPENVIKING_STATE_DIR:join(root,"state"),OPENVIKING_CODEX_STATE_DIR:join(root,"cx-state"),
          OPENVIKING_WRITE_PATH_ASYNC:"0",OPENVIKING_PEER_ID:"project",OPENVIKING_RECALL_COMPRESS:"off" };
        const script = (name) => resolve(`examples/${host}-memory-plugin/scripts/${name}.mjs`);
        expectExit(await runHookScript(script("auto-capture"), {
          input:{session_id:"sender-wire",transcript_path:transcript,cwd:root},env,cwd:root}));
        expectExit(await runHookScript(script("auto-recall"), {
          input:{session_id:"sender-wire",prompt:botText,cwd:root},env,cwd:root}));
      });
      assert.equal(batches.length,1);
      assert.deepEqual(batches[0].map((m)=>m.peer_id),[undefined,undefined,"bot-Claude"]);
      assert.ok(actors.length>0);
      assert.ok(actors.every((actor)=>actor==="bot-Claude"));
    } finally { await rm(root,{recursive:true,force:true}); }
  });
}
