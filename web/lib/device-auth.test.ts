// Self-check for the pure parts of the device-auth flow. The Rust client
// computes challenge = sha256(verifier) with the same algorithm — if this
// drifts, sign-in breaks with "Invalid or expired code", so pin it here.
// Run: npm test

import assert from "node:assert/strict";
import { sha256Hex, GRACE_HOURS } from "./device-auth";

// Known SHA-256 vectors — guards against accidentally switching algorithm or
// encoding (base64, uppercase, truncation…).
assert.equal(
  sha256Hex("abc"),
  "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
);
assert.equal(
  sha256Hex(""),
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
);

// The Rust verifier is two simple-format UUIDs (64 hex chars); its challenge
// must be 64 lowercase hex chars — exactly what /device-success validates.
const verifier = "0123456789abcdef".repeat(4);
assert.match(sha256Hex(verifier), /^[0-9a-f]{64}$/);

// Grace window sanity: long enough to survive a weekend offline, short enough
// that a cancelled subscription can't run for a week.
assert.ok(GRACE_HOURS >= 24 && GRACE_HOURS <= 96, `suspicious GRACE_HOURS: ${GRACE_HOURS}`);

console.log("device-auth self-check passed");
