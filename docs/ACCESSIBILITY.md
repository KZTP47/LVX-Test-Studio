# Readability and keyboard controls

Use **Light appearance** or **Dark appearance** beside the project name. The app remembers your choice. Both appearances keep the original colored Machina controls.

Press **Tab** or **Shift+Tab** to move between controls. A visible ring shows keyboard focus. Press **Enter** or **Space** to activate a button. **Escape** closes the current dialog and returns focus to its launcher.

In **Visual Web Tester**, select a step on the left to add it. Use its Edit button to change its settings, **Up** and **Down** to change the order, and **Delete** to remove it. In Debug Mode, the numbered breakpoint buttons can also be toggled with Space. Breakpoints follow their steps when you reorder them.

In a **visual workflow**, focus a node type and press Enter to add it. Activate an output connection, then an input connection, to join nodes using the keyboard. Connections have a named Delete button. Node configuration dialogs support Tab and Escape.

The app also supports 200% zoom, reduced-motion preferences and Windows contrast colors. The visual test preview shows the website being tested; that website has its own accessibility requirements.

## Verification

`node scripts/accessibility-e2e.cjs` checks the source app in a disposable Electron profile. Add `--packaged` to check `release/win-unpacked`. The check covers both appearances, task pages, node forms, dialog tabs, populated agents and visual tests, keyboard authoring, nested dialogs, focus return and zoom. It combines axe's WCAG A/AA rules with checks of text and placeholders against every declared gradient stop. Deliberately broken controls verify that both contrast checkers can fail.

Receipts and screenshots are stored under `docs/verification/accessibility-*.json` and `docs/screenshots/accessibility-*`. Axe results needing manual review remain in the receipts. Automated checks and inspected screenshots are not a full accessibility certification: a live screen-reader session, physical assistive hardware and arbitrary user websites are outside this check.
