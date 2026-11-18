/** @type {import("lint-staged").Configuration} */
export default {
  "*.{js,mjs,cjs,ts,mts,cts}": ["oxlint --fix", "oxfmt --no-error-on-unmatched-pattern"],
  "*.{json,jsonc,md,yml,yaml,css,html}": "oxfmt --no-error-on-unmatched-pattern"
}
