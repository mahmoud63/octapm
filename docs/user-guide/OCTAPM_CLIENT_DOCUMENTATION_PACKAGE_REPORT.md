# Client Documentation Package — Report

How the client documentation and the training kit were produced, what was checked, and what was
found. September 2026.

## Where it started and where it ended

| | |
| --- | --- |
| Documentation at the start of this phase | commit `fd11cb7` |
| Canonical source | `docs/user-guide/` |
| Product code changed | None |
| Deliverables | `deliverables/`, built by `tools/publishing` |

The Markdown remains the single source. Four sets of deliverables are assembled from it, and none
of them is a separate copy that could drift.

## Documentation quality pass

Run before anything was published.

| Check | Result |
| --- | --- |
| Broken internal links | 0 |
| Missing image references | 0 |
| Duplicate headings within a file | 0 |
| Raw identifiers in the text | 0 |
| Screenshot sizes | All 110 at 1440 by 900 |
| Role names used consistently | Yes. "Planner" and "Planning Engineer" both appear because the product's own role picker says Planning Engineer; the Planner guide says so on its first line. |
| Module names used consistently | Yes |
| Developer paths in client-facing text | 1 found and removed |

**What was fixed.** The role and feature matrix opened by naming the file the permission policy
lives in. A client reading a permissions table has no use for a path into the source tree, so the
line now says the rules were read from the product itself.

**What was added.** The workflow guide described all twenty-four workflows in prose but drew only
the two that join the others together. Twelve workflow diagrams were added to the source, covering
every chain the client documentation has to show as a picture: the request for information, the
change order, the procurement chain from package to order, the order through receipt and stock to
cost, the subcontract chain through certification to payment, labour, the client valuation chain,
inspection through non-conformance to closeout, and meetings through actions to tasks.

**What is filtered at publishing time rather than deleted.** The workflow guide ends each entry
with the screen files that evidence it. Those lines stay in the repository, where they are useful,
and are dropped on the way into the client documents, where a list of file names is not.

## Product findings disposition

Eighteen findings are on the register. It runs from UG-01 to UG-19 with no UG-15: that number was
never issued, so the count is eighteen, not nineteen. Each has been given exactly one disposition
in `OCTAPM_GUIDE_FINDINGS_DISPOSITION.md`.

| Disposition | Count | Findings |
| --- | --- | --- |
| A — Must fix before client training | 1 | UG-09 |
| B — Should fix before external pilot | 9 | UG-01, UG-04, UG-07, UG-10, UG-13, UG-14, UG-16, UG-18, UG-19 |
| C — Can carry during pilot | 6 | UG-02, UG-03, UG-05, UG-11, UG-12, UG-17 |
| D — Documentation observation only | 2 | UG-06, UG-08 |

The single item that must be settled before training is not a product change. Sixty-one companies
left over from earlier testing sit inactive in the demonstration organisation, and a trainee who
switches the filter sees a register that looks abandoned. A training organisation created clean
removes it, along with the archived-project residue behind UG-14 and UG-16.

Four findings deserve naming here because they will be in the room.

- **No login for a Client / Owner or a Subcontractor** (UG-01). Stated in the participant pack's
  first page rather than discovered.
- **No direct way to raise a purchase order** (UG-04). The route runs through a procurement package
  from a material requirement. This is the likeliest place for an independent exercise to stall, and
  the workbook says to measure the stall rather than explain it away.
- **Server-configuration wording on two screens** (UG-19). Document search and the daily log carry
  notices addressed to an administrator. A participant reads them as errors.
- **Internal references in the notification bell** (UG-13). Some items are named by a code.

Nothing in the product was changed in this phase.

## What was produced

| Deliverable | Pages | Formats |
| --- | --- | --- |
| Complete User Manual | 53 | PDF, Word |
| Quick Start | 10 | PDF, Word |
| Role handbooks (11) | 111 in total, 9 to 12 each | PDF, Word |
| Training and UAT Workbook | 18 | PDF, Word |
| UAT Participant Pack | 7 | PDF, Word |
| Trainer Guide | 7 | PDF, Word |
| Training Matrix | 4 sheets | Excel |
| **Total** | **206 pages across 16 documents** | 32 files |

Screenshots used: 61 figures placed across the set, drawn from the 110 validated images. Workflow
diagrams: 14 in the manual, of which 12 were added during this phase.

## Checks on the output

Each file was opened and inspected by the build's own quality pass.

| Check | Result |
| --- | --- |
| PDFs with a valid page tree | 16 of 16 |
| PDFs with a heading outline for the reader's sidebar | 16 of 16 |
| PDFs with working contents links | 16 of 16 |
| Contents pages numbered from the printed file | 16 of 16 |
| Word files whose document XML parses | 16 of 16 |
| Word files with heading styles, a contents field, a running header and a numbered footer | 16 of 16 |
| Tables too wide for the page | 0, after splitting anything past seven columns |
| Missing or broken images | 0 |
| Raw Markdown, developer paths or debug text in the output | 0 |

Covers, contents pages, figure captions, wide tables and the split permission matrix were also
looked at directly, page by page, in a viewer.

**How the contents numbers are produced.** The build prints each document once, reads back from the
file the page each contents entry actually landed on, and prints again with those numbers. They are
measured rather than estimated. If a file will not yield them, the entries are published unnumbered
rather than published wrong.

## Limits of this package

- **The Word contents page asks to be refreshed** on first open. That is Word's own behaviour for a
  contents field, and the note on the page says so.
- **Space Grotesk is named, not embedded**, in the Word files. A reader without the font sees Word's
  substitute. The PDFs carry their own type.
- **Schedule rests on earlier evidence** (UG-10). It was certified in an earlier phase and has not
  been driven end to end since, which makes the Planner's material the thinnest in the set.
- **The training matrix is empty**, deliberately.

## Verdicts

**Client documentation package: READY.** Sixteen documents, both formats, checked individually,
built from one source, with no unsupported persona described as available.

**UAT training kit: READY.** Four levels, ten connected scenarios, ten independent ones, observation
sheets, pass criteria, a trainer guide that says what to withhold, a participant pack with no
answers in it, and an empty matrix and defect register to fill in.

Neither verdict is a statement about the product. Whether OctaPM is ready for people who have never
seen it is what the training kit exists to find out, and that answer comes from a room with real
users in it.
