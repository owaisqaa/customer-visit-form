IQ Distribution Syria — Customer Visit Reports

HOST ON NETLIFY
1. Extract the ZIP.
2. Upload the dist folder in Netlify's manual deploy screen.
3. Share the resulting Netlify URL. No build command or backend is needed.
If importing the entire folder as a repository, netlify.toml sets dist as the publish directory.

USE
The form is in Arabic and retains all questions from the supplied PDF, with the original logo.
All 38 fields are optional. Completely blank and partially filled reports can be saved, reopened, edited, and exported to PDF. Blank customer names appear as an untitled report in history.
Drafts are saved automatically. Save adds a report to History; opening a report and saving updates that report.
Save & Download PDF exports a neatly paginated A4 report including the shop photo and all answers.
Clear / New Report starts a blank form after confirmation if there are unsaved changes.

HISTORY
History and photos are stored using IndexedDB in each visitor's browser on the same website address.
They are NOT shared between people, browsers, devices, or website addresses.
Deleting site data or using temporary/private browsing can remove the history. Keep PDF copies of important reports.
A shared team history or cross-device sync requires a separate authenticated backend.

COMPATIBILITY
Use a current Chrome, Edge, Firefox, or Safari browser. Location needs HTTPS and visitor permission.
Images are resized to a maximum dimension of 1600 pixels before saving.
PDF downloads contain high-resolution rendered Arabic text to preserve correct text shaping; text is not selectable.
No user responses or photos are sent to any server by this application. No external scripts, fonts, or APIs are used for PDF generation.

pdf-lib is bundled under the MIT license; see dist/pdf-lib.LICENSE.

ARABIC FONT
Cairo Regular, Medium and Bold are bundled from the supplied Cairo.zip. The webpage and PDF exports both use Cairo directly. Arabic letter spacing is normal throughout the page. See dist/Cairo-OFL.txt for the font license.

PDF PAGE LIMIT
Every report exports as two A4 pages: visit details and display materials on page 1; product scores and representative relationships on page 2. Compact paired fields save space. Text and spacing automatically shrink on a page with long answers, preserving all content without truncation. Very long notes can produce smaller print.
