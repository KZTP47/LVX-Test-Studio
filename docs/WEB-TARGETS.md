# Load a website for a visual test

Open **Create Visual Web Test**. Choose a source, load its preview, then add your test steps.

## Files and folders

**Choose folder** is the easiest way to load a complete website. LVX looks for HTML pages and their web assets. It prefers built sites in common output folders such as `dist`, `build` or `out`. It leaves out Git metadata, dependency folders, generated test reports, secret files and symbolic links.

For individual files, use **Add files** as often as needed. A matching path replaces that file. **Update** replaces one file's contents, **Path** changes its path inside the test, and **Remove** removes it from the test. These actions do not change the original on disk. Choose the HTML **Start page**, then **Reload Preview**. A folder is recommended when the website has many nested files.

Relative imports, JSON requests, CSS resources, images and links to other pages use the original file tree. Files are served through a temporary local website instead of being concatenated into one HTML string.

**Read folder / repository again** replaces the test copy with the current source. LVX asks before discarding edits made to that copy.

## Repositories

Choose **Git repository**, enter an HTTP(S) or supported SSH Git URL, and optionally enter a branch or tag. **Get repository** downloads a separate managed copy. It does not run project scripts or install dependencies. Git must be installed. Private repositories use the computer's existing Git authentication; no password is stored in the test.

Reading the repository again fetches the selected reference. Changes made to its managed copy can be replaced by that refresh; keep authored work in your original repository.

## Projects that need a server

React, TypeScript and similar source projects usually need their development server or a built output. LVX explains this instead of trying to execute raw source as plain HTML.

Review the package script, optionally select **Install dependencies first**, then choose **Start project website**. The confirmation describes what will run. LVX checks that the package and lock file still match what you reviewed. If they changed, read the source again and review the new command.

The built-in starter runs npm scripts and waits for a real local website response. Missing tools, install failures and startup failures appear beside the controls, with project output available. Other package managers or custom environments can be started normally outside LVX; choose **Website address** and enter that server's URL.

**Stop project website** cancels startup or stops the selected server. **Stop all project websites** also reaches servers whose source is no longer selected. It affects tests using those servers. Closing the app or switching LVX workspaces stops its managed project processes. Closing only the test editor leaves them available for saved tests and other runners.

## Staging and live websites

Enter the full `http://` or `https://` address, select **Use website**, then **Reload Preview**. Tests interact with the real site. Choose test accounts and data when a step submits a form or changes information.

**Open interactive preview** shows the same isolated website session. Its login state can be reused during the current app session. It does not share your normal browser's profile or LVX's desktop bridge. Server rules and login flows still apply; popup-only sign-in, downloads and device permissions are not enabled by this preview.

## Save and reopen

**Save as Test Suite** asks for a name. Portable file targets keep the files and steps together. They can run after the original folder connection expires and are included in normal project exports. Older uploaded tests keep their saved behavior.

Portable copies support up to 5,000 files and 12 MiB of serialized content. Larger static folders use their selected native folder directly instead. Native folder access and project-server connections last for the current app/workspace session; exported paths and source IDs do not grant access on another computer. Re-select the folder or get the repository again when LVX asks. A saved test never silently starts or installs a source project.

Saved tests use the same target in the editor, debugger, live runner and workflow graph. A missing source, stopped server or wrong assertion produces a visible failure or error, not a passing test.
