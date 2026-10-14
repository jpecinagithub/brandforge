# ADR-0004: REA (Reverse Engineer Anything) — dev-time research only

**Status:** Accepted (2026-10-14)
**Context:** REA (https://github.com/morluto/rea, MIT licence) describes itself
as "Reverse Engineer Anything": an MCP server + CLI that lets agents inspect
applications, binaries and websites and return structured evidence. The question
was whether it has any place in the BrandForge AI project.

**Decision:**

- REA is **useful ONLY as optional, dev-time research** — e.g. studying the
  *navigation flows and interaction patterns* of visual editors like Canva or
  Figma via its website-analysis target, **with authorization**, to inform our
  own original UX thinking.
- It is **NOT installed in production, NOT a dependency, NOT a build tool, and
  NOT a blocker** for any phase. Nothing in `package.json`, Dockerfiles, or
  deploy docs may reference it.

**Hard boundaries (non-negotiable):**

1. **Original design is mandatory.** REA may inform *understanding* of UX
   patterns; it must never be used to copy code, designs, copy, assets, or any
   other IP. All BrandForge IP is 100% original (standing project rule).
2. **Authorization only.** Website-analysis targets must be public pages we are
   allowed to inspect; no circumventing paywalls, ToS, or access controls.
3. **Evidence, not extraction.** If used, its output is treated like any other
   research note: summarized in the relevant ADR or design doc, with the source
   cited.

**Consequences:**

- (+) We keep a legitimate research tool available for UX homework without
  letting it anywhere near the product or the supply chain.
- (+) No licence/compliance surface: MIT, and not shipped.
- (−) None for the product. If REA ever looks like becoming load-bearing, this
  ADR must be revisited explicitly — it cannot happen by accident.
