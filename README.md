# Customer visit reports

Arabic customer visit form for IQ Distribution Syria, using the original logo and all 38 questions.

- All fields are optional. Save an empty report or a partially completed visit.
- Reopen saved reports, edit them, or start a new report.
- Automatic browser-local draft saving and history, including shop photos.
- Direct PDF downloads with correctly shaped Arabic text and page breaks.
- Bundled Noto Sans Arabic Regular and Bold, used consistently for the page and PDF exports.
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

The reference ZIP contains a translation script specifying font fallbacks, not a font file. This project bundles its named Arabic font, Noto Sans Arabic, and registers it as `Visit Arabic` so installed system fonts cannot override it. PDF text is rendered at high resolution to preserve Arabic shaping; it is not selectable text.

Third-party licenses are included in `dist`. The supplied logo remains the property of its owner.
