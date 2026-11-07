# Workbench V8 — Quiet Studio

Status: development authorized by the user on 2026-11-06. Visual review precedes production UI implementation, as agreed in the V8 plan. Additional requirement: more selectable themes.

## Baseline and delivery boundaries

Start from main 7a38c391c0bdf8b7370dd468d4bd33689284daf7. Branch: codex/v8-quiet-studio. Preserve existing config/external-tools.json changes and all unrelated untracked local artifacts. Do not stage whole workspace. Keep production API and data/store.json authoritative. No destructive schema migration.

Release identity: Workbench V8 — The Quiet Studio; prerelease v8.0.0-beta.1, final v8.0.0 after local acceptance. Branch creation is authorized; final publication follows the agreed local acceptance gate. Do not tag an incomplete design preview as a finished V8 release.

## Information architecture and preservation matrix

Keep canonical route IDs and handlers as compatibility contracts. Group entrances without renaming record IDs or conflating business projects and collaboration runs. Old bookmarks remain valid and highlight the appropriate new parent.

| Current entrance | V8 parent / secondary entrance | Behaviors to preserve |
|---|---|---|
| home | Today / Overview and Decisions | Module cards, order, ownership, actual task progress, risks and decisions |
| agenda | Today / Schedule | Day/week/month, filters, dates, completion, reminders, materials, review drafts, both report workflows |
| briefs | Today / Briefings | Sources, unread/read, favorites, filters, source run details |
| projects | Projects / Business projects and Collaboration | Distinct project/module/run identity, creation, rooms, messages, delivery, review, execution governance |
| agents | Projects / Members | Member detail, inbox, availability, real execution evidence and claims |
| reports | Reflections / Reports OR Library / Interests | daily/retro/guidance/weekly/assessment/monthly/quarterly/business under Reflections; pain/frontier/ai-new/construction/lab under Library |
| assets | Library / Assets | Skills studio, disk skill discovery, knowledge atoms, materials, lessons, prompts, pending items, sources, extensions |
| learn | Library / Learning | Learning plans, draft cache, existing actions; schedule references visible from Today |
| life | Today / Life | Existing life management and task actions; not just converted to calendar entries |
| tools | Tools & Settings / External tools | Existing tools, SJZZ Start/Open UI, availability and errors |
| set | Tools & Settings / Settings | Language, appearance, provider configuration, vault, reminders, companion, help and all existing settings |

Cross-cutting actions: safe-confirmed command composer, archive/manage/restore, search, keyboard navigation, language switching, responsive navigation, desktop shell and robot remain reachable. Record each concrete action during implementation against this matrix; no removal without user decision.

## Theme system

Existing application already exposes 24 named themes. V8 must not silently reduce them to four or overwrite an existing saved preference.

Recommended curated gallery:
1. Quiet Studio: warm ivory, charcoal, jade; selected visual reference and default for a new V8 appearance preference.
2. Moonlit Ink: deep charcoal/ink, warm pale text, muted jade, dark landscape artwork.
3. Porcelain Blue: clean porcelain, slate typography, restrained blue; crisp daylight alternative.
4. Autumn Paper: warm paper, umber text, terracotta accents; gentle warm alternative.

Provide thumbnail cards showing an actual miniature interface, instant reversible preview, Apply and Cancel. Keep existing named themes in a Classic collection. Existing explicit preferences persist; offer a deliberate Switch to V8 appearance action rather than silently replacing them.

Add independent comfort controls: comfortable/compact density, decorative artwork on/off, reduced motion; optional Follow system chooses an explicit light/dark pairing and cannot override a manually chosen theme. Preference scope and persistence must be explained in the UI. Reuse meta.theme for saved theme identity; new preference fields require whitelist/default validation and backward-compatible migration. Preview must not write the ledger. Save appearance must update only appearance fields.

All themes use common semantic tokens for surfaces, text, navigation, focus, borders, selection, danger, warning, success and disabled states. Cover editor textareas, native selects, modals, code blocks, toasts and long content, not only sidebar colors. Normal text contrast target 4.5:1, large text and meaningful component boundaries 3:1. Status must not depend on color alone. Respect prefers-reduced-motion. Validate Chinese and English typography, including long titles.

## Screen specifications

Today: date, small landscape accent, priorities and full schedule access. Priority count is derived from real selections; never fabricate a three-item limit. Decisions panel uses real underlying states and links. Task detail opens alongside schedule, with notes/reflection/materials; preserve draft by record ID across selection, navigation, theme preview and refresh paths supported by current caches. Narrow screens use a full-width detail view with Back.

Projects: list-first hierarchy of business projects and collaboration runs, explicit switch between them, real status and owner. Selected run shows room/thread and relevant controls. Advanced execution details in an expandable area. Opening an item does not execute it.

Reflections: chronological searchable writing with period/type filters, original review and saved note provenance, clear draft versus saved state. Monthly thoughts generation retains thoughts-v1 source coverage and member choice. Saving to Reports/Obsidian remains explicit and verified. No summary replaces the original writing.

Library: categorized assets with second-level navigation, scoped search, selected-item preview and source details. Separate scanned skills, published versions and actual adoption evidence. Keep Learning and Interests accessible, not merged into unrelated records.

Tools & Settings: readily reachable bottom entrance; appearance gallery visible without scrolling through provider settings. Changes to layout do not change model routing, WorkBuddy scheduling, or SiliconFlow pause.

## Architecture and implementation order

1. Feature map and visual package (this stage): inspect navigation.mjs, app.js, views.js and centers.js; deliver secondary screens and theme comparisons for visual review.
2. Shell: separate V8 navigation grouping from existing route resolution. Introduce scoped V8 styles and semantic theme registry. Preserve classic layout as a reversible fallback during rollout. Never maintain a second business store.
3. Today plus reflection details: reuse existing actions/API contracts; add controlled detail state and draft preservation before moving forms.
4. Projects, Reflections, Library and settings: migrate by entrance with compatibility checks for every matrix row and cross-cutting action.
5. Accessibility, responsive and visual verification, followed by local user acceptance.
6. Version metadata, release notes, selective source commit, GitHub branch/PR, then approved release tagging.

Use existing JavaScript frontend, Node service and Electron shell. No framework replacement is needed for this visual migration. Open-source references from planning: https://github.com/actualbudget/actual and https://ui.shadcn.com/docs/components/base/sidebar (layout patterns only; verify licenses before copying code).

## Acceptance

- All old canonical URLs resolve to the same records and actions and have a visible V8 entrance.
- Schedule create/reschedule/review/summary/save/readback, report completeness and member selection remain intact.
- Source drift, held results, uncertain execution ownership, retry budgets and review separation retain existing behavior.
- Theme preview/cancel/apply and reload preserve writing, selection and unrelated ledger fields; all curated themes pass contrast and visual checks.
- Desktop close/hide/reopen and robot positioning remain functional.
- Verify 1440px, 1024px and 390px layouts, long Chinese and English titles, empty/error/loading states, large lists and keyboard operation.
- Run existing npm test, test:agents, test:ui and desktop-companion regression as appropriate before final release; add targeted meaningful coverage for grouping and appearance transitions.
- No private configuration, ledger, source notes, logs, local research artifacts or credentials enter GitHub.

## Current review checkpoint

2026-11-07: user authorized switching the local workbench to V8. Local preview implementation now includes grouped navigation, Today schedule/decision/reflection sections from real records, original-reflection browsing/search, four semantic palettes, classic theme selection, preview/cancel/apply/reload, system pairing, density, artwork toggle, and reversible classic layout. Existing route IDs and action handlers are preserved. Appearance is explicitly stored per browser in localStorage; cross-device profile synchronization is deferred. A full embedded task/editor redesign and uniform redesign of all legacy detail pages remain later V8 work; this is not a finished v8.0.0 release.

Review images: [Themes](design/v8/theme-concepts.png), [Desktop entrances](design/v8/desktop-concepts.png), [Narrow-screen flow](design/v8/mobile-concepts.png). These are generated design references with illustrative records, not screenshots of implemented functions. Incidental dates, generated text, and mascot variations are not requirements: retain the approved existing D robot. Rich-text toolbar imagery is not authorization to replace the current Markdown/plain-text storage or editor. Mobile-responsive design does not by itself provide remote phone access; networking/authentication deployment is a separate scope.


## Local verification, 2026-11-07

- test/v8-studio.browser.cjs: grouped and legacy destinations, reflection filtering, theme preview/cancel/apply/reload, all 24 classic options, classic-layout return path, unsaved command preservation, mobile width; zero business writes.
- navigation-centers browser test updated to navigate through visible V8 entrances; passed existing identity, chat draft, source isolation, languages and route assertions.
- agenda-reschedule, agenda-review-draft and saved-review-report browser tests passed with isolated data/adapters.
- test:agents and desktop-companion passed.
- npm test passed tests through archive, route and V3 checks, then failed the existing external-tools assertion: retellloop expected one action while the pre-existing custom configuration contains three. No V8 backend changes; retain the local configuration. Do not claim the complete suite passed.
- Translation check passed. Full visual/release acceptance remains pending; no GitHub push or release tag in this stage.
