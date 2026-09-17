# Local readers for Files & AI

The reader pipeline lives in `app/lib/document-readers.js`. Import validation accepts supported files up to 512 MB. Importing does not provision readers, contact an AI service or start an analysis. `readDocument` validates the stored original's SHA-256 before deriving any content.

## Setup

The application can call `getReaderStatus()` and `provisionReaders({signal, onProgress})` from `app/lib/reader-dependencies.js`. Setup is an explicit user action. It installs to `%LOCALAPPDATA%/CaseForge/readers/v1`, outside the case folder. No administrator access or system service is required. The `CASE_FORGE_READERS_DIR` environment variable can select another managed directory.

For development:

```powershell
node scripts/setup-readers.mjs --status
node scripts/setup-readers.mjs
```

Setup verifies pinned checksums before extracting or invoking any downloaded executable. Its receipt is published only after all required files exist. Partial installations can be retried. ZIP paths, sizes, CRCs and symbolic links are checked before writing. Downloads are currently Windows x64 only, roughly 720 MB; allow additional space for extraction and case derivatives.

| Dependency | Pinned source |
| --- | --- |
| Java runtime | Eclipse Temurin 21.0.12.1+1, official GitHub release |
| Office and email reader | Apache Tika 3.3.2, Apache archive with SHA-512 |
| Media decoder | FFmpeg 8.0, Gyan essentials Windows build linked by FFmpeg's download page |
| Speech engine | whisper.cpp official Windows CPU build b5130 |
| Speech model | Multilingual Small, ggerganov/whisper.cpp model repository commit `5359861c739e955e79d9a303bcbc70fb988958b1` |

whisper.cpp v1.9.4's release page has no Windows assets. The installer therefore pins the official b5130 binary archive and reports that build honestly. It does not label that binary v1.9.4. Dependency licences and notices included in archives remain alongside installed readers; release packaging must preserve required notices and source/redistribution obligations.

## Reader contract

`readDocument({root, record, signal, dependencies?, onProgress?})` accepts a canonical case root and a record containing `id`, `name` and case-relative `original`. It returns:

- `pages`: integer source IDs, text and structured page/paragraph/cell/timestamp anchors. Non-PDF IDs are source-block identifiers, not claims of printed page numbers.
- `images`: case-relative derived image paths and matching source IDs/anchors.
- `attachments`: separately saved original bytes, names, parent document ID and embedded-path provenance. The caller registers these; the parent scan does not analyse their contents.
- `coverage`: completion, warnings, visual sampling and recording coverage.
- `reader`: the actual reader name/version used.

PDF.js reads text and renders the first page, text-poor pages and pages with filing or seal indicators. Reports disclose other searchable pages whose graphics were not inspected. Native image decoding retains no fabricated OCR text; AI image reading occurs later. Multi-frame GIF/TIFF input remains explicitly incomplete until all frames can be supplied separately.

Tika preserves paragraphs and extracted table coordinates; `locationBasis: extracted-table` distinguishes a reconstructed cell locator from an independently verified workbook coordinate. Email header information remains in metadata and extracted text. Attachments are returned separately, including PDF embedded files. ZIP archives return a manifest and separately saved members.

Recordings are limited to two hours per file. FFmpeg decodes mono 16 kHz audio; whisper.cpp runs locally with two CPU threads and emits millisecond timestamps. Speaker identity is left unknown. Video combines scene-change samples with frames at ten-second intervals, retaining true source timestamps. Adjacent near-duplicate frames are removed only when their structure and average colours agree. Reports disclose visual sampling; frame limits cause an incomplete result, not a false completion.

Unreadable, encrypted, changed-source, missing-dependency and incomplete states are typed `ReaderError` values. Derived work from a failed read is removed; originals are retained.

## Verification

```powershell
node --test app/tests/document-readers.test.js
$env:CASE_FORGE_READERS_TEST_DIR = 'C:\path\to\provisioned\readers'
node --test app/tests/document-readers-native.test.js
```

The native suite uses fictional RTF, MIME attachments, generated video and Windows synthesized speech. It skips when a provisioned directory is not explicitly selected. The speech fixture needs Windows speech-synthesis access; a restricted process sandbox can block it even when the reader itself is available.

Upstream references: [Tika CLI](https://tika.apache.org/3.3.2/gettingstarted.html), [Tika extraction path checks](https://github.com/apache/tika/blob/3.3.2/tika-app/src/main/java/org/apache/tika/cli/TikaCLI.java), [FFmpeg downloads](https://ffmpeg.org/download.html), [whisper.cpp CLI](https://github.com/ggml-org/whisper.cpp/tree/v1.9.4/examples/cli).
