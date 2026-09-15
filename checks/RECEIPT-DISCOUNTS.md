# Receipt discounts — 2026-09-15

An item displaying `-1,000` was parsed as `+1,000` because the positive payment parser removed its sign. Two products at 12,000 and 10,000 therefore incorrectly totalled 23,000 instead of 21,000.

Item drafts now use a signed parser for preview, creation and editing. Locale-specific group/decimal separators roundtrip through the form, including Spanish and Vietnamese. Corrections/refunds use the same signed total for editing, preview and saving. The sample splits to 11,500 and 9,500 for the two selected participants. Storage and settlement already support signed item amounts; no database migration is needed.

Receipt extraction distinguishes actual products/fees/discounts from summaries, zero-price options, informational benefits, included amounts and uncertain adjustments. Actual discounts remain negative. Detailed discounts and their repeated total are not both applied. A sole applied discount total stays; real repeated products and separately charged VAT stay. Printed totals are still checked independently; discrepancies are not silently filled with invented discounts.

Validation:

- `node scripts/receipt-discount-test.mjs`: 6 parser/form/allocation/storage-mapping checks, including locale roundtrips.
- `node checks/receipt-items.mjs`: 20 cases using the actual extraction function with mocked model responses.
- `node checks/receipt-edit.mjs`: 12 cases driving actual edit handlers with mocked actions/hooks.
- `node checks/handoff-repro.mjs`: 9 existing regression groups.
- `npm run simulate`: settlement invariants passed.
- `npm run build`: production build and type checks passed.
- Local browser harness with the actual ItemLines component: 21,000 total, 11,500/9,500 per participant, serialized discount -1,000.

No actual model request, customer receipt upload, production record write or historical data correction was performed in these checks. Model OCR accuracy remains subject to image quality and must be reviewed before saving. Uncertain or missing totals continue to show an unbalanced result. Existing saved entries are not rewritten by this change.
