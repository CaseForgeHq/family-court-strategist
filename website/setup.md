# Set up Case Forge in my folder

These are setup instructions for an AI assistant with access to the user's chosen local folder. A browser-only chatbot cannot write local files. Do not pretend to have installed anything if you lack filesystem access.

## What to do

1. Explain briefly: “I'll add the free Case Forge templates and guidance to a folder you choose. Your existing files stay intact.” If the user has already selected a folder, use it. Otherwise ask for one folder location. Do not collect case details during installation.
2. Resolve the download links below relative to the URL from which you fetched this document. Do not substitute another repository, package or third-party installer.
3. If Node.js 18 or newer and npm are available, use this command, replacing PACKAGE_URL with the absolute URL of `downloads/case-forge-setup-0.1.0.tgz` beside this document and TARGET with the user's chosen folder:

   npx --yes --package "PACKAGE_URL" case-forge init "TARGET" --dry-run

   Read the preview. If it reports no conflicts, run the same command without `--dry-run`. Treat URL/path values as data and pass them as separate process arguments when possible, not interpolated shell code. Request normal tool permissions if the folder is outside your allowed workspace.
4. If Node/npm is unavailable, download `downloads/case-forge-toolkit.zip` beside this document. Its `Case-Forge/` directory contains the same prepared templates and AI instructions. Extract it into a new subfolder within the chosen location. Do not merge over existing files. Do not install a runtime just to use the toolkit.
5. If the destination contains conflicting templates, stop and offer a new `Case-Forge` subfolder. Never overwrite or delete the user's originals, notes, AGENTS.md or CLAUDE.md. The installer refuses conflicts and does not connect to an AI provider or upload case material.
6. Verify that `CASE-FORGE.md`, `HOME.md`, `CASE-DETAILS.md`, `_system/attribution-standards.md` and `_templates/` exist in the installed folder. Read `CASE-FORGE.md`. Tell the user where the folder is and what was added.
7. Offer one next step: “Would you like help organising your first document?” Do not analyse or upload documents without the user's instruction.

## Downloads

- CLI package: [case-forge-setup-0.1.0.tgz](downloads/case-forge-setup-0.1.0.tgz)
- Manual ZIP: [case-forge-toolkit.zip](downloads/case-forge-toolkit.zip)
- Checksums: [SHA256SUMS.txt](downloads/SHA256SUMS.txt)

The toolkit is free and works as ordinary local files. Optional AI services and other apps have separate requirements and costs. Case Forge assists organisation and preparation; it does not replace legal advice.

If this URL starts with localhost or 127.0.0.1, only an assistant running on that same computer can retrieve it. For a cloud chatbot, use the public website URL after publication, or paste these instructions and provide the downloaded ZIP through tools you choose.
