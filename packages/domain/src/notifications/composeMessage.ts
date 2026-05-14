// packages/domain/src/notifications/composeMessage.ts
// Session 13 — Phase 5.B — Notifications pipeline.
//
// Pure {{var}} Mustache-lite substitution for notification templates.
// Deterministic, IO-free, no escaping (plain-text bodies only in v1).
//
// Grammar :
//   - `{{name}}` → look up `name` in `variables` ; substitute its
//     `String(value)` form. `null`/`undefined` count as MISSING.
//   - Missing variables are LEFT IN PLACE (literal `{{name}}`) and
//     returned in `missingVars` so callers can warn / fail-soft.
//   - No conditionals, no loops, no nested paths. Keys must match
//     `[a-zA-Z_][a-zA-Z0-9_]*`.

import type { NotificationTemplate, ComposeResult } from './types.js';

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

export type TemplateVariables = Record<string, string | number | boolean | null | undefined>;

/**
 * Substitute `{{var}}` placeholders in template.subject_template and
 * template.body_template. Returns the composed strings + the list of
 * placeholders that had no matching variable (NULL/undefined count as
 * missing).
 */
export function composeMessage(
  template: Pick<NotificationTemplate, 'subject_template' | 'body_template'>,
  variables: TemplateVariables,
): ComposeResult {
  const missing = new Set<string>();

  const subject = substitute(template.subject_template ?? '', variables, missing);
  const body    = substitute(template.body_template,         variables, missing);

  return {
    subject,
    body,
    missingVars: [...missing],
  };
}

function substitute(
  source: string,
  variables: TemplateVariables,
  missing: Set<string>,
): string {
  return source.replace(PLACEHOLDER_RE, (match, name: string) => {
    const value = variables[name];
    if (value === undefined || value === null) {
      missing.add(name);
      return match; // leave the placeholder in place
    }
    return String(value);
  });
}
