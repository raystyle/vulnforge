/**
 * Error envelope: every tool failure surfaces atomically for agent
 * self-correction — a stable machine-keyed code, the offending detail, and
 * an actionable hint. The hint is tool-usage guidance (how to call the tool
 * correctly) — attack-chain next-steps belong to the script-level AgentResult
 * next_suggestion field, never here (docs/contracts/rs-contracts.md).
 */
export const VF_ERROR_CODES = [
  "CONFIG_NOT_FOUND",
  "CONFIG_INVALID",
  "PATH_ESCAPE",
  "PATH_NOT_FOUND",
  "PARAM_CONFLICT",
  "NO_FIX_COMMANDS",
  "TEMPLATE_INVALID",
  "EDIT_REJECTED",
  "ENGINE_UNAVAILABLE",
  "RS_SCRIPT_NOT_FOUND",
  "RS_ENVELOPE_INVALID",
  "RS_BUILD_FAILED",
  "CANCELLED",
  "INTERNAL",
] as const;
export type VfErrorCode = (typeof VF_ERROR_CODES)[number];

export function vfError(code: VfErrorCode, detail: string, hint: string): Error {
  const error = new Error([`vf-error code=${code}`, detail, `hint: ${hint}`].join("\n"));
  error.name = "VfError";
  return error;
}

/** Wrap boundary errors (config/edit/yaml) in the envelope, pass through others. */
export function wrapAsVfError(
  error: unknown,
  classify: (message: string) => { code: VfErrorCode; hint: string },
): Error {
  if (error instanceof Error && error.message.startsWith("vf-error code=")) return error;
  const message = error instanceof Error ? error.message : String(error);
  const { code, hint } = classify(message);
  return vfError(code, message, hint);
}
