# Ghostery adblocker (MPL-2.0)

The desktop app depends on `@ghostery/adblocker-electron` and `@ghostery/adblocker-electron-preload` 2.18.2 and their dependencies `@ghostery/adblocker`, `@ghostery/adblocker-content`, `@ghostery/adblocker-extended-selectors`, `@ghostery/url-parser`, `@remusao/guess-url-type`, `@remusao/small`, `@remusao/smaz`, `@remusao/smaz-compress`, `@remusao/smaz-decompress` and `@remusao/trie`. These packages are licensed under the Mozilla Public License 2.0 (https://www.mozilla.org/MPL/2.0/). Glade redistributes them unmodified. `tldts-core` and `tldts-experimental`, also pulled in, are MIT licensed.

Source code:

- Ghostery packages: https://github.com/ghostery/adblocker/tree/v2.18.2 (each package is also published on npm with its source).
- `@remusao/*` packages: https://github.com/remusao/mono

The filter lists (EasyList, EasyPrivacy, Peter Lowe's list and uBlock Origin's lists) are not part of the app. The browser downloads them from the Ghostery repository at runtime and keeps a compiled copy in the app's user data folder.
