<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Design System
Always read `DESIGN.md` before making any visual or UI decision. Fonts, colors,
spacing, components, and aesthetic direction are defined there and mirror the live
tokens in `app/globals.css`. Do not deviate without explicit user approval. In QA,
flag any UI that doesn't match `DESIGN.md`.
