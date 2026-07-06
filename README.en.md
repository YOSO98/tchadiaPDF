English | [Français](README.md)

<h1 align="center">tchadiaPdf</h1>

<p align="center">Free, unlimited, open source PDF toolkit. Your files never leave your browser.</p>

<p align="center">
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/licence-MIT-2563EB"></a>
  <a href="#the-43-available-tools"><img alt="43 tools" src="https://img.shields.io/badge/outils-43-2563EB"></a>
  <a href="https://tchadiapdf.com"><img alt="Site online" src="https://img.shields.io/website?url=https%3A%2F%2Ftchadiapdf.com"></a>
  <a href="CONTRIBUTING.md"><img alt="PRs welcome" src="https://img.shields.io/badge/PRs-welcome-2563EB"></a>
  <a href="#contributing"><img alt="5 languages" src="https://img.shields.io/badge/langues-5-2563EB"></a>
</p>

<p align="center"><a href="https://tchadiapdf.com"><strong>tchadiapdf.com</strong></a></p>

<p align="center"><em>Boîte à outils PDF gratuite, illimitée et open source. Vos fichiers ne quittent jamais votre navigateur.</em></p>

## Preview

![tchadiaPdf home page listing the Edit, Convert and other PDF tool categories](docs/screenshots/accueil.png)

![The Edit PDF editor with a PDF loaded: side toolbar, page thumbnail and existing text being edited](docs/screenshots/editeur.png)

*The editor screenshot reflects its current state. A redesign of the interface (editable zones shown as dashed outlines, a side style panel) is underway in a separate branch and will be reflected here once shipped.*

## Why tchadiaPdf

- **Free with no limit**: no account to create, no daily quota, no feature reserved for a paid tier.
- **100% private**: all processing happens in your browser tab, no file is ever sent to a server. This absence of network traffic is verified by an automated test that intercepts every request during a real conversion: [tests/no-network-leak.spec.js](tests/no-network-leak.spec.js).
- **Open source**: auditable code under the MIT license, contributions welcome.

## The 43 available tools

### Edit

| Tool | Link |
|---|---|
| Edit PDF | [tchadiapdf.com/modifier-pdf.html](https://tchadiapdf.com/modifier-pdf.html) |

### Convert

**To PDF**

| Tool | Link |
|---|---|
| JPG to PDF | [tchadiapdf.com/jpg-en-pdf.html](https://tchadiapdf.com/jpg-en-pdf.html) |
| Word to PDF | [tchadiapdf.com/word-en-pdf.html](https://tchadiapdf.com/word-en-pdf.html) |
| Excel to PDF | [tchadiapdf.com/excel-en-pdf.html](https://tchadiapdf.com/excel-en-pdf.html) |
| PowerPoint to PDF | [tchadiapdf.com/powerpoint-en-pdf.html](https://tchadiapdf.com/powerpoint-en-pdf.html) |
| Text to PDF | [tchadiapdf.com/texte-en-pdf.html](https://tchadiapdf.com/texte-en-pdf.html) |
| HEIC to PDF | [tchadiapdf.com/heic-en-pdf.html](https://tchadiapdf.com/heic-en-pdf.html) |
| WebP to PDF | [tchadiapdf.com/webp-en-pdf.html](https://tchadiapdf.com/webp-en-pdf.html) |
| TIFF to PDF | [tchadiapdf.com/tiff-en-pdf.html](https://tchadiapdf.com/tiff-en-pdf.html) |
| BMP to PDF | [tchadiapdf.com/bmp-en-pdf.html](https://tchadiapdf.com/bmp-en-pdf.html) |
| SVG to PDF | [tchadiapdf.com/svg-en-pdf.html](https://tchadiapdf.com/svg-en-pdf.html) |
| Markdown to PDF | [tchadiapdf.com/markdown-en-pdf.html](https://tchadiapdf.com/markdown-en-pdf.html) |
| HTML to PDF | [tchadiapdf.com/html-en-pdf.html](https://tchadiapdf.com/html-en-pdf.html) |
| EPUB to PDF | [tchadiapdf.com/epub-en-pdf.html](https://tchadiapdf.com/epub-en-pdf.html) |

**From PDF**

| Tool | Link |
|---|---|
| PDF to JPG | [tchadiapdf.com/pdf-en-jpg.html](https://tchadiapdf.com/pdf-en-jpg.html) |
| PDF to Word | [tchadiapdf.com/pdf-en-word.html](https://tchadiapdf.com/pdf-en-word.html) |
| PDF to Excel | [tchadiapdf.com/pdf-en-excel.html](https://tchadiapdf.com/pdf-en-excel.html) |
| PDF to PowerPoint | [tchadiapdf.com/pdf-en-powerpoint.html](https://tchadiapdf.com/pdf-en-powerpoint.html) |
| PDF to text | [tchadiapdf.com/pdf-en-texte.html](https://tchadiapdf.com/pdf-en-texte.html) |

**Images**

| Tool | Link |
|---|---|
| HEIC to JPG | [tchadiapdf.com/heic-en-jpg.html](https://tchadiapdf.com/heic-en-jpg.html) |
| PNG to JPG | [tchadiapdf.com/png-en-jpg.html](https://tchadiapdf.com/png-en-jpg.html) |
| JPG to PNG | [tchadiapdf.com/jpg-en-png.html](https://tchadiapdf.com/jpg-en-png.html) |
| SVG to PNG | [tchadiapdf.com/svg-en-png.html](https://tchadiapdf.com/svg-en-png.html) |

### All other tools

| Tool | Link |
|---|---|
| Merge PDF | [tchadiapdf.com/fusionner.html](https://tchadiapdf.com/fusionner.html) |
| Compress PDF | [tchadiapdf.com/compresser-pdf.html](https://tchadiapdf.com/compresser-pdf.html) |
| Split PDF | [tchadiapdf.com/diviser.html](https://tchadiapdf.com/diviser.html) |
| Rotate PDF | [tchadiapdf.com/pivoter.html](https://tchadiapdf.com/pivoter.html) |
| Organize PDF | [tchadiapdf.com/organiser-pdf.html](https://tchadiapdf.com/organiser-pdf.html) |
| Page numbers | [tchadiapdf.com/numeros-de-pages.html](https://tchadiapdf.com/numeros-de-pages.html) |
| Watermark | [tchadiapdf.com/filigrane.html](https://tchadiapdf.com/filigrane.html) |
| Crop PDF | [tchadiapdf.com/rogner-pdf.html](https://tchadiapdf.com/rogner-pdf.html) |
| Protect PDF | [tchadiapdf.com/proteger-pdf.html](https://tchadiapdf.com/proteger-pdf.html) |
| Repair PDF | [tchadiapdf.com/reparer-pdf.html](https://tchadiapdf.com/reparer-pdf.html) |
| Unlock PDF | [tchadiapdf.com/deverrouiller-pdf.html](https://tchadiapdf.com/deverrouiller-pdf.html) |
| Sign PDF | [tchadiapdf.com/signer-pdf.html](https://tchadiapdf.com/signer-pdf.html) |
| OCR PDF | [tchadiapdf.com/ocr-pdf.html](https://tchadiapdf.com/ocr-pdf.html) |
| PDF forms | [tchadiapdf.com/formulaires-pdf.html](https://tchadiapdf.com/formulaires-pdf.html) |
| Compare PDF | [tchadiapdf.com/comparer-pdf.html](https://tchadiapdf.com/comparer-pdf.html) |
| Scan a document | [tchadiapdf.com/scanner-pdf.html](https://tchadiapdf.com/scanner-pdf.html) |
| Flatten PDF | [tchadiapdf.com/aplatir-pdf.html](https://tchadiapdf.com/aplatir-pdf.html) |
| PDF metadata | [tchadiapdf.com/metadonnees-pdf.html](https://tchadiapdf.com/metadonnees-pdf.html) |
| Extract images | [tchadiapdf.com/extraire-images-pdf.html](https://tchadiapdf.com/extraire-images-pdf.html) |
| Booklet PDF | [tchadiapdf.com/livret-pdf.html](https://tchadiapdf.com/livret-pdf.html) |

## Technology

tchadiaPdf is a 100% static site: HTML, CSS and JavaScript with no framework and no build step. File processing happens entirely on the client side, using these libraries (full version and license details in [DEPENDENCIES.md](DEPENDENCIES.md)):

- [pdf-lib](https://github.com/Hopding/pdf-lib): reading, writing and assembling PDF documents
- [pdf.js](https://github.com/mozilla/pdf.js): rendering pages and extracting existing text
- [Tesseract.js](https://github.com/naptha/tesseract.js): text recognition (OCR) for scanned PDFs
- [qpdf](https://qpdf.readthedocs.io/) compiled to WebAssembly ([qpdf-wasm](https://github.com/neslinesli93/qpdf-wasm)): AES-256 encryption and repair of corrupted PDFs

Other targeted libraries (mammoth.js, SheetJS, docx, pptxgenjs, html2canvas, marked, epub.js, UTIF.js, heic2any, JSZip) power the conversion tools, loaded only when the corresponding tool needs them. Two heavy tasks are offloaded to a Web Worker so the interface never freezes: image recompression in Compress PDF (`js/compresser-pdf.worker.js`) and DOCX parsing in Word to PDF.

## Running locally

The site is static: no installation is required to browse it, just a local HTTP server (double-clicking the files directly does not work, Web Workers need an http/https origin).

1. Clone the repository:
   ```bash
   git clone git@github.com:YOSO98/tchadiaPDF.git
   ```
2. Serve the folder with a static server, for example:
   ```bash
   npx http-server -p 8080
   # or
   python -m http.server 8080
   ```
3. Open `http://localhost:8080` in your browser.

### Running the tests

The [Playwright](https://playwright.dev/) test suite lives in `tests/`.

```bash
npm install
npx playwright test
```

## Contributing

Contributions are welcome: a new tool, a translation, a bug fix or a documentation improvement. See [CONTRIBUTING.md](CONTRIBUTING.md) for the design system rules (only two colors, white and blue) and the steps to add a tool. Participation in the project is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).

Two simple ways to help:

- **Report a bug**: open an [issue on GitHub](https://github.com/YOSO98/tchadiaPDF/issues).
- **Suggest a tool or a translation**: the home page is available in 5 languages (French, English, Spanish, Portuguese, Arabic); translating a tool page or adding a new one are good first contributions.

## Supporting the project

tchadiaPdf is free and will stay free. The project may in the future be funded through advertising (already built into the code, disabled until the user gives consent) and through donations.

<!-- Ko-fi link to add once the account is created: https://ko-fi.com/tchadiapdf -->
<!-- GitHub Sponsors link to add once the account is created: https://github.com/sponsors/YOSO98 -->

## License

Project distributed under the [MIT](LICENSE) license.

## Acknowledgments

tchadiaPdf relies on these open source libraries: pdf-lib, pdf.js, JSZip, mammoth.js, SheetJS, docx, pptxgenjs, html2canvas, marked, epub.js, UTIF.js, heic2any, Tesseract.js, @pdf-lib/fontkit and @neslinesli93/qpdf-wasm, as well as the Inter and Liberation Fonts typefaces. Full version and license details in [DEPENDENCIES.md](DEPENDENCIES.md).
