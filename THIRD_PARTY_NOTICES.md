# Third-party components

Dependencies remain subject to their upstream licenses. This file does not assign a license to LVX Test Studio.

| Component | Pinned version | Upstream license/source |
|---|---|---|
| Electron | 44.9.3 | MIT and bundled Chromium notices; electronjs.org |
| Playwright | 1.58.0 | Apache-2.0; github.com/microsoft/playwright |
| Monaco Editor | 0.44.0 | MIT and ThirdPartyNotices.txt; github.com/microsoft/monaco-editor |
| Chart.js | 4.4.0 | MIT; github.com/chartjs/Chart.js |
| html2canvas | 1.4.1 | MIT; github.com/niklasvh/html2canvas |
| Pyodide | 0.24.1 | MPL-2.0 for Pyodide project; npm packaging declares Apache-2.0; bundled CPython/packages have their own licenses; github.com/pyodide/pyodide |
| SheetJS CE | 0.20.3 | Apache-2.0; cdn.sheetjs.com/xlsx-0.20.3/package/ |
| Robot Framework | 7.3.2 | Apache-2.0; github.com/robotframework/robotframework |
| pytest | Pyodide lockfile version | MIT; package metadata included in bundled wheel |
| Tailwind CSS | 3.4.17 | MIT; build-time utility generator |
| sharp | 0.35.5 | Apache-2.0; build-time icon conversion |
| electron-builder | 26.18.0 | MIT; build-time packaging |
| yaml | 2.9.1 | ISC; [eemeli/yaml](https://github.com/eemeli/yaml) |
| Tween.js | 25.0.0 | MIT; [tweenjs/tween.js](https://github.com/tweenjs/tween.js); bundled as assets/vendor/tween.esm.js with assets/licenses/tweenjs-LICENSE |
| TypeScript | 6.0.3 | Apache-2.0 and included ThirdPartyNoticeText.txt; [microsoft/TypeScript](https://github.com/microsoft/TypeScript) |
| diff (jsdiff) | 9.0.0 | BSD-3-Clause; [kpdecker/jsdiff](https://github.com/kpdecker/jsdiff) |
| web-tree-sitter | 0.20.8 | MIT; [tree-sitter/tree-sitter](https://github.com/tree-sitter/tree-sitter) |
| tree-sitter-wasms packaging | 0.1.13 | Unlicense; [Gregoor/tree-sitter-wasms](https://github.com/Gregoor/tree-sitter-wasms) |
| Python grammar used by the source editor | 0.21.0, from tree-sitter-wasms | MIT; [tree-sitter-python v0.21.0](https://github.com/tree-sitter/tree-sitter-python/tree/v0.21.0) |
| C# grammar used by the source editor | 0.20.0, from tree-sitter-wasms | MIT; [tree-sitter-c-sharp v0.20.0](https://github.com/tree-sitter/tree-sitter-c-sharp/tree/v0.20.0) |

Vendored JavaScript retains its license banners. Package versions and npm integrity are recorded in package-lock.json. The Pyodide package lock records wheel hashes; wheel distribution metadata includes package licenses. Chromium/FFmpeg resources retain their upstream license files. The build also copies available UI package license files into assets/licenses. SheetJS download provenance is in assets/vendor/PROVENANCE.json.

The project's original code is distributed under MIT, selected by the owner on 2026-10-24. Third-party components retain their own licenses. No signing/publishing credentials are configured here.

Native Python extras are installed into a project-local directory and included as a separate packaged resource. Exact versions are listed in `scripts/python-runtime-requirements.txt`: pytest (MIT), Robot Framework (Apache-2.0), iniconfig (MIT), packaging (Apache-2.0/BSD-2-Clause), pluggy (MIT), Pygments (BSD-2-Clause), colorama (BSD-3-Clause), exceptiongroup (MIT) and typing_extensions (PSF-2.0). Their distribution metadata and license files are retained in `resources/python-packages/*.dist-info`. CPython, a JDK and .NET are detected on the user's computer and are not redistributed by this installer.
## Visual API and contract testing

OpenAPI parsing and in-memory repository reference resolution use `@apidevtools/swagger-parser` 12.1.0 and `@apidevtools/json-schema-ref-parser` under MIT. Response validation uses `ajv` 8.20.0 and `ajv-formats` 3.0.1, both MIT. Their original license texts are copied unchanged into `assets/licenses` by the asset build and included in the desktop package. The package lock pins transitive runtime dependencies; their original notices also remain in the packaged dependency directories. Postman and Pact formats informed the import adapters; no upstream Postman application or native Pact verifier code is copied into these adapters. See `docs/API-ATLAS.md` for sources and supported semantics.

## YAML parsing

GitHub Actions source inspection uses yaml (eemeli/yaml), distributed under the ISC license. The browser build and license are bundled locally by `npm run build:assets`.

## Repository source editing

TypeScript parses JavaScript/TypeScript source without executing the imported project. Its Apache-2.0 license and accompanying third-party notices are copied unchanged to `assets/licenses/typescript-LICENSE.txt` and `assets/licenses/typescript-ThirdPartyNoticeText.txt`. Unified diff generation uses jsdiff under BSD-3-Clause; its notice is in `assets/licenses/diff-LICENSE`.

Python and C# inspection uses web-tree-sitter and the Python/C# grammar binaries from tree-sitter-wasms. The runtime MIT notice is in `assets/licenses/web-tree-sitter-LICENSE`. The packaging project's Unlicense text is in `assets/licenses/tree-sitter-wasms-LICENSE`; it does not replace the grammar authors' licenses. The used grammar MIT notices are retained separately in `assets/licenses/tree-sitter-python-LICENSE` and `assets/licenses/tree-sitter-c-sharp-LICENSE`.

Grammar license files were retrieved unchanged from their upstream release tags. The tree-sitter-wasms npm release's recorded source commit and lockfile identify Python 0.21.0 and C# 0.20.0. Source URLs, license hashes and the used WASM hashes are recorded in `assets/licenses/tree-sitter-wasms-PROVENANCE.json`. The asset build copies production package notices locally and requires those grammar notices to be present.
