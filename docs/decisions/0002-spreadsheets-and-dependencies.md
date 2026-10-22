# 0002 Spreadsheet libraries and dependency hygiene

Date: 22 October 2026. Status: agreed.

**Context.** The prototype used `xlsx` 0.18.5 from npm to read customers' spreadsheets. It has high-severity advisories (prototype pollution, regular-expression denial of service) and no fixed release on npm; SheetJS now publishes fixes only from its own registry, which this build workspace cannot reach. Rory first chose SheetJS from its registry, then, when it proved unreachable, ExcelJS.

**Decision.**
- **ExcelJS** for `.xlsx` and **PapaParse** for `.csv`, both behind `src/lib/spreadsheet.ts`, so the choice can change in one place.
- Old binary `.xls` files are refused with advice to resave as `.xlsx` (ExcelJS cannot read them).
- Uploads are treated as hostile: size, row and cell limits; content checked as well as extension; rows built without a prototype; formulas never evaluated or exported as formulas (CSV injection is neutralised).
- ExcelJS loads only when a spreadsheet is opened or exported, keeping it out of the main bundle.
- `npm overrides` pin fixed versions of `uuid` under ExcelJS.
- Install with **npm 11**: npm 10 hits a resolver bug (`Cannot read properties of null (reading 'edgesOut')`) with this tree.

**Accepted exception.** `npm audit` still reports `braces` (high, no fixed release) and `postcss-selector-parser` (moderate) inside Tailwind 3's build tooling. They are development-only, run only over our own source files at build time and never see user input. Production dependencies audit clean, and CI fails on any high or critical production finding. Moving to Tailwind 4 would remove them; logged in the backlog.
