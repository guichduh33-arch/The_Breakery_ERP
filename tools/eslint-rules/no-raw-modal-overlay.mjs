// tools/eslint-rules/no-raw-modal-overlay.mjs
//
// Session 22 / Phase 1.A.2 — ESLint rule forbidding raw fullscreen overlay
// `<div>`s outside the canonical `@breakery/ui` modal primitives.
//
// Why ?
//   The repo standardises on Radix-backed Dialog / Sheet / FullScreenModal /
//   CenterModal which handle focus-trap + Esc + scroll-lock + a11y for free.
//   Anything that re-implements a fullscreen overlay by hand (a `<div>` with
//   `position: fixed` AND `inset: 0`) bypasses that and tends to regress on
//   keyboard accessibility (TAB escapes the modal, focus is never restored,
//   etc.). This rule catches such anti-patterns at lint time.
//
// What we flag :
//   1. `<elem className="… fixed … inset-0 …" />` — both `fixed` and `inset-0`
//      as whitespace-separated tokens in a literal className string.
//   2. `<elem style={{ position: 'fixed', inset: 0 | '0' }} />` — both
//      properties present in an inline style ObjectExpression.
//
// Exempt paths :
//   * `packages/ui/**` — the canonical home of modal primitives
//   * `**/__tests__/**`, `**/*.test.(ts|tsx|js|mjs)`, `**/*.stories.(ts|tsx)`
//   * `**/node_modules/**`
//   * `tools/eslint-rules/**` — the rule's own test fixtures contain the
//     forbidden patterns inside string literals

/** @type {import('eslint').Rule.RuleModule} */
export const noRawModalOverlay = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbids raw fullscreen overlay <div>s outside @breakery/ui — use Dialog/FullScreenModal/CenterModal/Sheet instead.',
      recommended: true,
    },
    schema: [],
    messages: {
      noRawModalOverlay:
        'Avoid raw fullscreen overlay div ; use Dialog/FullScreenModal/CenterModal/Sheet from @breakery/ui — these are Radix-backed and handle focus-trap + Esc + a11y for free.',
    },
  },

  create(context) {
    // ESLint 8.40+ exposes `context.filename` ; older flat-config callers may
    // still rely on `getFilename()`. Accept both.
    const filename =
      typeof context.filename === 'string'
        ? context.filename
        : typeof context.getFilename === 'function'
          ? context.getFilename()
          : '';

    const EXEMPT = [
      /[\\/]packages[\\/]ui[\\/]/,
      /[\\/]__tests__[\\/]/,
      /\.test\.(ts|tsx|js|jsx|mjs|cjs)$/,
      /\.stories\.(ts|tsx|js|jsx)$/,
      /[\\/]node_modules[\\/]/,
      /[\\/]tools[\\/]eslint-rules[\\/]/,
    ];

    if (EXEMPT.some((re) => re.test(filename))) {
      return {};
    }

    /**
     * className tokeniser : treats whitespace-separated tokens as
     * individual classes, like Tailwind does.
     */
    function hasClassTokens(value, tokens) {
      if (typeof value !== 'string') return false;
      const parts = new Set(value.split(/\s+/).filter(Boolean));
      return tokens.every((t) => parts.has(t));
    }

    /**
     * Extract the static string value of a JSXAttribute, if any.
     * Supports both `className="..."` and `className={"..."}` forms.
     */
    function staticStringValue(attrValue) {
      if (attrValue === null) return null;
      if (attrValue.type === 'Literal' && typeof attrValue.value === 'string') {
        return attrValue.value;
      }
      if (
        attrValue.type === 'JSXExpressionContainer' &&
        attrValue.expression.type === 'Literal' &&
        typeof attrValue.expression.value === 'string'
      ) {
        return attrValue.expression.value;
      }
      return null;
    }

    /**
     * From an ObjectExpression, return a map of literal-key → literal-value
     * pairs. Properties with computed keys, spreads, methods, or non-literal
     * values are skipped (we only care about the simple case).
     */
    function extractStaticProps(objExpr) {
      const out = {};
      for (const prop of objExpr.properties) {
        if (prop.type !== 'Property') continue;
        if (prop.computed) continue;
        let key;
        if (prop.key.type === 'Identifier') key = prop.key.name;
        else if (prop.key.type === 'Literal' && typeof prop.key.value === 'string') {
          key = prop.key.value;
        } else {
          continue;
        }
        if (prop.value.type === 'Literal') {
          out[key] = prop.value.value;
        }
      }
      return out;
    }

    function isFixedInsetStyleObject(objExpr) {
      const props = extractStaticProps(objExpr);
      const isPositionFixed = props.position === 'fixed';
      const insetVal = props.inset;
      const isInsetZero =
        insetVal === 0 || insetVal === '0' || insetVal === '0px';
      return isPositionFixed && isInsetZero;
    }

    return {
      JSXAttribute(node) {
        const name = node.name && node.name.type === 'JSXIdentifier' ? node.name.name : null;

        // Case 1 — className literal containing both `fixed` and `inset-0`
        if (name === 'className') {
          const str = staticStringValue(node.value);
          if (str !== null && hasClassTokens(str, ['fixed', 'inset-0'])) {
            context.report({ node, messageId: 'noRawModalOverlay' });
            return;
          }
        }

        // Case 2 — style={{ position: 'fixed', inset: 0 }}
        if (name === 'style') {
          if (
            node.value &&
            node.value.type === 'JSXExpressionContainer' &&
            node.value.expression.type === 'ObjectExpression' &&
            isFixedInsetStyleObject(node.value.expression)
          ) {
            context.report({ node, messageId: 'noRawModalOverlay' });
          }
        }
      },
    };
  },
};

export default { rules: { 'no-raw-modal-overlay': noRawModalOverlay } };
