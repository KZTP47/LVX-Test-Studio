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

Vendored JavaScript retains its license banners. Package versions and npm integrity are recorded in package-lock.json. The Pyodide package lock records wheel hashes; wheel distribution metadata includes package licenses. Chromium/FFmpeg resources retain their upstream license files. The build also copies available UI package license files into assets/licenses. SheetJS download provenance is in assets/vendor/PROVENANCE.json.

The project's original code is distributed under MIT, selected by the owner on 2026-10-24. Third-party components retain their own licenses. No signing/publishing credentials are configured here.

Native Python extras are installed into a project-local directory and included as a separate packaged resource. Exact versions are listed in `scripts/python-runtime-requirements.txt`: pytest (MIT), Robot Framework (Apache-2.0), iniconfig (MIT), packaging (Apache-2.0/BSD-2-Clause), pluggy (MIT), Pygments (BSD-2-Clause), colorama (BSD-3-Clause), exceptiongroup (MIT) and typing_extensions (PSF-2.0). Their distribution metadata and license files are retained in `resources/python-packages/*.dist-info`. CPython, a JDK and .NET are detected on the user's computer and are not redistributed by this installer.
