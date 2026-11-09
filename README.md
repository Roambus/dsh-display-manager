# dsh-sidebar-fold

Collapse the sidebar panel list, and choose which plugin entries appear in the sidebar, the conversation header/footer, and Settings. Display only — it never enables or disables a plugin.

[中文说明](./README.zh.md)

## What it does

The DSH web shell puts plugin content in four places at once: the left sidebar panel list, the top and bottom of the conversation window, and the Settings page. Install a handful of plugins and every one of those places gets crowded. This plugin gives you two things:

1. **Fold the panel list.** A slim grip sits on the seam between the sidebar's panel list and the workspaces region. Click it and the panel list collapses, handing that vertical space back to the workspaces — the main pain point on a small screen. Click again to expand. The fold state persists per window.

2. **Display management.** A page inside the main panel (and a section in Settings) lists every entry that currently renders in each of the four regions. Toggle an entry off and it stops appearing there; toggle it back on whenever you want. Hidden entries keep running — only their presence in the UI changes.

## Boundaries

This plugin manages **display only**. It never writes `cordis.patch.yml`, never changes the plugin market's state, and never uninstalls or disables anything. Hiding an entry only removes it from the interface; the plugin itself keeps running and can be brought back from the same page.

The plugin also obeys its own rule: it can appear in the sidebar (panel entry + management page) or in Settings (a full switch section). At least one of the two must stay on, otherwise you could never find it again — the UI enforces this.

Some controls share a single container in the current layout and cannot be told apart, so they show as "cannot hide yet" rather than being hidden blindly.

## Regions managed

| Region | Covers |
| --- | --- |
| Left panel list | Plugin entries in the sidebar (`sidebar.panellist`) |
| Conversation header | Actions, utilities, corner and lineage slots beside the session title |
| Conversation tabs | The `conversation / trajectory / context / team` view switcher row |
| Conversation footer | Controls around the composer, plus the bars above and below it |
| Settings | The section list on the left of Settings |

## Install

```sh
dsh plugin --profile web add Roambus/dsh-sidebar-fold
```

## Requirements

- `package.json` declares a `dsh.bundle` manifest pointing at `cordis.patch.yml` (included).
- Browser-side UI only; it needs no official `@deepseek-ai/*` package at runtime beyond what the harness already provides.

## License

MIT — see [LICENSE](./LICENSE).
