# V8 Paper Library

User approved development on 2026-11-19 after inspection of https://agent01-7e0.pages.dev/ and data.js. MVP: explicit metadata import, V8 Library/Papers entrance, title/topic/source search, selected public PDF downloads, identity/content deduplication, local reading state and favorites, provenance, original collection link. No bulk download, login bypass, automatic Obsidian write or AI calls.

## Architecture and contracts

- Existing Node service and JavaScript UI. Business records in store.paperLibrary only; PDFs under ignored data/papers, never public/ or GitHub. Import does not execute remote JavaScript: parse only the known window.AGENT_DATA JSON assignment, with schema and size bounds.
- Source counts are claims, not verified totals; show actual imported unique records and raw entries, preserve source URL, timestamp, SHA256, categories and original external links. Titles/descriptions remain collector-provided metadata.
- GET /api/papers: records, source metadata, ephemeral download progress/errors; no remote fetch. POST /api/papers/import: fixed collection data URL, explicit refresh; identity merge preserves read/favorite/download data and retains records removed upstream with sourcePresent=false.
- POST /api/papers/:id/download: registered ID only; candidate derived from stored original links, fixed public host allowlist validated on every redirect, HTTPS only. One active transfer; concurrent same-ID requests return the same task. 40 MiB cap, bounded timeout, PDF MIME/signature/EOF and length checks. Full file SHA256/readback before ledger reference. Content hash also deduplicates files across records. No request body URL or destination path accepted.
- GET /api/papers/:id/file: verify registered local file size/hash and stream PDF. PATCH /api/papers/:id: reading status (unread/reading/finished) and favorite only. POST /api/papers/:id/folder: highlight verified local PDF. Mutations/files local-only with Origin/Sec-Fetch checks. Loopback fetch-origin restrictions prevent public websites driving downloads.
- Markitdown button launches the existing registered Markitdown_tao desktop tool after explicit click; not an automatic CLI converter. User chooses the downloaded PDF in its GUI. Opening it is not conversion completion.

## Reference designs and risks

Zotero separates bibliographic identity and attachments; Paperless documents SHA256-based duplicate handling. Sources: https://www.zotero.org/support/licensing , https://github.com/paperless-ngx/paperless-ngx/blob/dev/docs/usage.md . Their code is not copied or installed. Collector licensing and attribution remain separate from access to original open papers; display original collection and paper links. Do not republish a mirrored website or claim its headings are verified counts.

Prior targeted vault search found historical experience distinguishing DOI/abstract links from actual downloadable full text. Those historical passages are not proof of access to this collection. The preceding inspection parsed 297 entries, 288 unique titles and 250 distinct arXiv IDs; current counts must be derived on import.

## Verification

Use isolated ledger/files and injected HTTP responses for schema rejection, repeated imports, source removal, state retention, deduplication, blocked hosts/redirects, MIME/signature/truncation, size/time limits, retries, concurrent download ownership, tamper detection and path safety. Browser checks cover V8 entrance, search/filter/state, explicit import/download, error states, mobile, original links and no implicit external fetch. A real import plus one explicitly reported public sample PDF may validate local deployment. No claim all links work from sampling alone.

Backend deployment requires a controlled server restart. Check active execution ownership first; do not interrupt real agents or auto-resume old jobs. Save a local ledger backup without modifying pause/scheduler preferences. App startup side effects must be considered separately from paper import.

## Local acceptance, 2026-11-19

Implemented on codex/v8-quiet-studio. The source currently imports 297 records, with 271 supported PDF-link candidates; candidate links are not all verified downloads. The two Feishu collection links are preserved separately as references with unverified access/content, not counted as imported full papers.

Isolated paper module/API/browser tests passed, including search losing focus before a favorite click (fixed), reading/favorite retention, source refresh/removal, blocked redirects/hosts, invalid/truncated PDFs, bounded transfers, content duplicate reuse, missing/tampered files and recoverable repair. Tampered downloaded bytes are retained in a .changed-* file before replacing them with a newly verified copy. V8, navigation-center and canonical-route checks passed; translation coverage passed. Paper page follows V8 palettes instead of inheriting the classic navy asset workspace.

Live acceptance: imported the actual source, downloaded one public sample (arXiv 2601.14192), read back its complete 17,865,678 bytes through the local endpoint, and verified SHA256 44328ee7a9ecadd9c96c0d8d904ac127a1336aa3287300e883d974f9c03e3c35. Re-requesting the sample reuses the verified file. Existing agendas, reports, tasks, department runs, execution attempts, relevant job collections and remote configuration were compared with the local pre-deployment backup. Local evidence and PDFs remain in ignored data directories. No real Markdown conversion, Obsidian write, bulk download or GitHub push performed. User acceptance of the interface remains pending.
