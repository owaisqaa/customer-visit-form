# Customer visit reports

Arabic customer visit form for IQ Distribution Syria, using the original logo and all 38 questions.

- All fields are optional. Save an empty report or a partially completed visit.
- Reopen saved reports, edit them, or start a new report.
- Automatic browser-local draft saving and history, including shop photos.
- Direct two-page A4 PDF downloads with correctly shaped Arabic text and automatic fitting.
- Bundled Cairo Regular, Medium and Bold, used consistently for the page and PDF exports.
- No build tools, external scripts, or backend required.

## Connect to Netlify

Import this repository in Netlify and select the `main` branch.

| Setting | Value |
| --- | --- |
| Base directory | Leave empty |
| Build command | Leave empty |
| Publish directory | `dist` |

The included `netlify.toml` already sets the publish directory. Allow public access if the form should be available to anyone with the link.

For manual deployment, upload the `dist` folder.

## Data and history

Reports and photos are stored in IndexedDB in the visitor's browser. They are not uploaded to GitHub or Netlify and are not shared between visitors, devices, browsers, or site addresses. Clearing browser data removes reports. Keep PDF copies of important visits.

## Fonts and PDF

The project bundles Cairo Regular, Medium and Bold directly from the supplied Cairo.zip. The webpage and PDF exports both use this bundled Cairo family, so installed system fonts cannot override it. PDF text is rendered at high resolution to preserve Arabic shaping; it is not selectable text.

Third-party licenses are included in `dist`. The supplied logo remains the property of its owner.

## PDF page limit

Every report exports as two A4 pages: visit details and display materials on page 1; product scores and representative relationships on page 2. Compact paired fields save space. Text and spacing automatically shrink on a page with long answers, preserving all content without truncation. Very long notes can produce smaller print.

## Saving a PDF on iPhone / Safari

After generating the report, a ready dialog offers **Save or share PDF** on devices supporting native file sharing. On iPhone, choose **Save to Files** in the share sheet. Sharing starts from a fresh tap after generation, preserving Safari's user-activation requirement.

A separate **Download PDF** link remains available when sharing is unsupported or fails. It targets another tab so Safari's PDF viewer cannot replace the form. Download URLs remain valid for the originating document's lifetime; closing the dialog or returning from a PDF does not expire them. Unused URLs are not allocated, and repeated downloads of the same prepared report reuse its URL.

Canceling sharing keeps the report available, and **Return to page** closes the dialog without changing form answers or history.

## Download regression checks

Run `node --test tests/pdf-delivery.test.cjs` with Node.js 18 or later. These checks simulate sharing success, cancellation, failure, separate-tab downloads and PDF URL lifetime. They do not replace testing on an actual iPhone.
