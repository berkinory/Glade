# Glade Changelog

## 0.2.1 - Unreleased

### New

- Visual replies and previews can load public web resources, and visual links open in your browser.

### Improved

- Claude chats load core Glade tools automatically and discover other tools as needed, reducing context usage.
- Subagent rows use stable names instead of Claude task descriptions, show model names or aliases without extra labels, and keep task prompts, agent types and redundant background-agent banners out of the compact panels.
- Provider transitions prepare in the chat while you continue using other chats.
- Visual replies blend into the chat with automatic height and compact download and expand controls.
- Visual previews require a smaller browser download while keeping local network access blocked.
- Chat activity hides routine accepted approvals while keeping refusals, broader grants and Computer permission decisions visible.
- Long lists of edited files scroll within the chat instead of pushing the rest of the conversation away.
- Full Access no longer asks again before Codex uses Glade's own tools.

### Fixed

- Glade tools, including visual replies, are available in Claude chats without manually naming them.
- Continuing a Claude chat with Codex works after the Claude session has been retired.
- Changing the app theme preserves edits and interactive state in visual replies.
- Conversation rows stay correctly positioned as activity details change, and message navigation stays clear of the text at every chat width and side panel layout.
- Image attachments stay reliable when the composer remounts or an image finishes preparing after you switch chats.
- Glade recovers abandoned startup locks that contain only Finder metadata, and explains locks it cannot verify with a way to open the logs.
- Quitting asks for confirmation when the app window can't respond instead of quitting without checking for running chats.
- Opening a path in the terminal no longer types into a busy shell, and a terminal that fails to close stays open and usable.
- Voice dictation is available for Codex ChatGPT sign-ins, and invalid transcription responses show a clear error.
- Chats show why they are blocked by a provider delivery failure as soon as it happens, including after a restart.

### Removed

- Removed the source-code view from visual replies.

## 0.2.0 - 2026-10-06

### New

- Agents can create interactive charts, diagrams and other visuals in chat, with theme support, expansion, saving and source inspection. ([65d6518a0](https://github.com/berkinory/Glade/commit/65d6518a065a2009097cc19759c180ab72f3ddc1))
- Continue with another provider in the same chat while preserving context and a record of the handoff. ([bf04f7241](https://github.com/berkinory/Glade/commit/bf04f7241b230bc677252da4f0ac7cd598dca66d), [3cd47a8a9](https://github.com/berkinory/Glade/commit/3cd47a8a91007cd8f173ef899ee7f705f273b388))
- Open files, diffs, terminals and browser pages in conversation workspace tabs, with configurable navigation shortcuts. ([baeefe9e9](https://github.com/berkinory/Glade/commit/baeefe9e947fa831e5ff30619e5958ffdc19b7a5), [e6ef0f1cf](https://github.com/berkinory/Glade/commit/e6ef0f1cf488f35c86fd870a56e5a840e73baa90))
- Split terminals horizontally or vertically within a workspace tab. ([728ab177e](https://github.com/berkinory/Glade/commit/728ab177efe9c36ab6dcbdd4c4d19ba616a14e5e))
- Create local Git repositories and publish them to GitHub from Source Control. ([1141ffe5b](https://github.com/berkinory/Glade/commit/1141ffe5b5c964234bad879351614f0b54e3033d))
- Sign in to Claude and Codex directly from provider settings. ([4c606b49a](https://github.com/berkinory/Glade/commit/4c606b49a2d41d897d59595d817351443e2e939c))
- See Claude and Codex usage limits in the sidebar, with short-term and weekly views and expandable credit balances. ([4c606b49a](https://github.com/berkinory/Glade/commit/4c606b49a2d41d897d59595d817351443e2e939c), [5cffa3d65](https://github.com/berkinory/Glade/commit/5cffa3d655f87b539d04057c5b771f79d47655d3))
- Add files and folders to Explorer by dragging them in or pasting from the clipboard. ([d93f9c1f7](https://github.com/berkinory/Glade/commit/d93f9c1f778b6d33b83b8a221e32f7cecf1500c2))
- Hear distinct sounds for completed replies and requests for your attention, with an option to mute them. ([11d754af5](https://github.com/berkinory/Glade/commit/11d754af5e6685b24334526ff9b19ef11160fe4a))
- Enable native window transparency on macOS and Windows 11. ([d552f882a](https://github.com/berkinory/Glade/commit/d552f882a6eeeffc6433bcec7f3d02a03b1c38c4))
- Agents can inspect task diffs, fork conversations, discover local servers and open files, diffs and terminals in Glade. ([5f43094f8](https://github.com/berkinory/Glade/commit/5f43094f83476787138c17f5a8eeb8925c1365f1))
- Cycle supported model effort levels with Shift+Tab in the composer. ([493ceb3b8](https://github.com/berkinory/Glade/commit/493ceb3b8842e92ff519b83abd21f0837c6c156d))
- Open referenced conversations directly from chat links in agent replies. ([493ceb3b8](https://github.com/berkinory/Glade/commit/493ceb3b8842e92ff519b83abd21f0837c6c156d))
- Chats receive automatic titles from meaningful messages while preserving manual renames. ([43427aefa](https://github.com/berkinory/Glade/commit/43427aefa125da9f2e8114fb6d747f4d294f562e))
- Unsent drafts are marked in the sidebar and easier to find in Activity. ([b1c843277](https://github.com/berkinory/Glade/commit/b1c8432777cbb6849650f313b04cd8835467b36e))

### Improved

- Follow subagents in chat and Environment with character avatars, clearer model information and a quick return to the main conversation. ([85f1c7c5a](https://github.com/berkinory/Glade/commit/85f1c7c5a6fe69d0610dc4eea11d4ea4ea8787f0))
- Subagents use current provider model and thinking options, with focused context and follow-up instructions coordinated through the main chat. ([85f1c7c5a](https://github.com/berkinory/Glade/commit/85f1c7c5a6fe69d0610dc4eea11d4ea4ea8787f0))
- Source Control and History stay up to date as files and repositories change, while keeping open previews in place. ([ec6856ee5](https://github.com/berkinory/Glade/commit/ec6856ee5b719a42f991cadd4151f559f9329024), [6fa09d682](https://github.com/berkinory/Glade/commit/6fa09d6826b171d6629dedae47095f79c49f7bdb))
- Push synchronizes incoming commits automatically and offers clear actions to resolve conflicts or cancel the operation. ([ec6856ee5](https://github.com/berkinory/Glade/commit/ec6856ee5b719a42f991cadd4151f559f9329024))
- Undo the latest unpublished commit without losing its changes. ([ec6856ee5](https://github.com/berkinory/Glade/commit/ec6856ee5b719a42f991cadd4151f559f9329024))
- Use either provider for Git writing, including commit messages and branch names, with better handling of large changes. ([a337bdcb9](https://github.com/berkinory/Glade/commit/a337bdcb95e961e2d53ccf5dade8efcbe8f080f0), [18212a60b](https://github.com/berkinory/Glade/commit/18212a60b380e8ec414ae4875bf7d6018845a1de))
- File mentions find misspelled and multilingual filenames more reliably, including in large projects. ([7ddb07983](https://github.com/berkinory/Glade/commit/7ddb07983667df8f4f2a66c0c7be5be54eb9d1ae))
- Explorer searches file contents with faster repeat searches and highlighted matches; quick-open handles filename search. ([9a3e78475](https://github.com/berkinory/Glade/commit/9a3e784754e180f6857021a2cb21f6991c10d9a7), [9918cea52](https://github.com/berkinory/Glade/commit/9918cea52b10021c4fc444f794774406b65d96b3))
- Explorer and Git previews show images and video thumbnails, including media from the selected revision. ([5f51a61c6](https://github.com/berkinory/Glade/commit/5f51a61c6763dcd91f752a216189eb385bdf819a))
- Markdown opens in preview by default and remembers your viewing preference across files. ([f62446c7f](https://github.com/berkinory/Glade/commit/f62446c7f927a91a9b9212ff9165b2ba023dfaed))
- Voice dictation works while agents are running and can be finished or sent with Enter. ([1478e1871](https://github.com/berkinory/Glade/commit/1478e1871a46f2109aef9b05741886b4ba3349f0))
- Tool activity and reasoning show clearer progress and expandable details without hiding long results. ([42c94c5dd](https://github.com/berkinory/Glade/commit/42c94c5dd14f6f70e82394a74822c09d1f2d4d6e), [3457f46e0](https://github.com/berkinory/Glade/commit/3457f46e0a187f2932a4ed57a64738efbc1cecd5))
- Desktop downloads and installations are smaller. ([614aa7d61](https://github.com/berkinory/Glade/commit/614aa7d61584a7eeee87cfda3a10cbba1a3c68ed))
- Provider handoffs retain key decisions and unfinished work, show transferred context and keep earlier conversation details accessible. ([3cd47a8a9](https://github.com/berkinory/Glade/commit/3cd47a8a91007cd8f173ef899ee7f705f273b388), [bf04f7241](https://github.com/berkinory/Glade/commit/bf04f7241b230bc677252da4f0ac7cd598dca66d))
- Agents can browse conversation lists in pages and choose a provider and model when creating tasks. ([5f43094f8](https://github.com/berkinory/Glade/commit/5f43094f83476787138c17f5a8eeb8925c1365f1))
- New chats offer a direct Worktree toggle, and you can start another chat while a worktree is being prepared. ([c58efa7d2](https://github.com/berkinory/Glade/commit/c58efa7d2ea5a0a60332dd425fcda43e41f471c6))
- Environment shows the working directory and worktree location, including the source checkout while preparation is pending. ([196e1453f](https://github.com/berkinory/Glade/commit/196e1453fb243e3e6a8a8300547f435f97e4ef93), [13b16dd74](https://github.com/berkinory/Glade/commit/13b16dd749c079ab64fa0787a2c703e71c9ab23f))
- File links open in editable workspace tabs without losing unsaved edits; Explorer navigation can be hidden to give files more room. ([f62446c7f](https://github.com/berkinory/Glade/commit/f62446c7f927a91a9b9212ff9165b2ba023dfaed), [55d8e3309](https://github.com/berkinory/Glade/commit/55d8e3309b60fbd1d4d80f104c5e73a1c1a53a53))
- Source Control stays responsive with large change lists and applies stage, unstage and revert to the full selection within each group. ([5f51a61c6](https://github.com/berkinory/Glade/commit/5f51a61c6763dcd91f752a216189eb385bdf819a))
- Generate a commit message and commit all changes directly when nothing is staged. ([f62446c7f](https://github.com/berkinory/Glade/commit/f62446c7f927a91a9b9212ff9165b2ba023dfaed))
- GitHub lookups pause during rate limits and resume after the cooldown. ([d89b6cb7b](https://github.com/berkinory/Glade/commit/d89b6cb7bf8ee41f296695b7291ab500e0017d85))
- Models load faster on first use and start with balanced reasoning when no effort preference is set. ([46cddbaae](https://github.com/berkinory/Glade/commit/46cddbaae7976249f96d821609a1ee42c922f1f8))
- Chat switching and Activity stay more responsive with long conversation histories. ([76cbd4c7c](https://github.com/berkinory/Glade/commit/76cbd4c7c32229762aa86ba98d71ee3f5e2f5501))
- Profile statistics load faster with larger conversation histories. ([19a15c164](https://github.com/berkinory/Glade/commit/19a15c1640297a484687fa1b67a96e8d3d79ea68))
- Markdown images open in a larger preview while linked images keep their normal link behavior. ([493ceb3b8](https://github.com/berkinory/Glade/commit/493ceb3b8842e92ff519b83abd21f0837c6c156d))
- Project icons, including monorepo favicons, make pinned chats and Activity easier to identify. ([7afd1c5a5](https://github.com/berkinory/Glade/commit/7afd1c5a56d0d89e4a91b8e6ef53191ebe83b833), [b1c843277](https://github.com/berkinory/Glade/commit/b1c8432777cbb6849650f313b04cd8835467b36e))
- Tool activity uses recognizable service logos for supported MCP servers across providers and the plugin library. ([cf10daff9](https://github.com/berkinory/Glade/commit/cf10daff9f81c82a29df972c7aabf0fa1a1f859c))

### Fixed

- Interrupted sends and reconnects preserve messages, drafts and attachments without duplicate delivery. ([3dcb8b016](https://github.com/berkinory/Glade/commit/3dcb8b016ddee352fe8a92be24e5fe0269937ed1), [c58efa7d2](https://github.com/berkinory/Glade/commit/c58efa7d2ea5a0a60332dd425fcda43e41f471c6))
- Claude recovers from missing native conversations, and Codex renews its connection after a stalled turn. ([31e3c2d4b](https://github.com/berkinory/Glade/commit/31e3c2d4b60be696d86e4660566f2d3983d436cf))
- Claude compaction handles startup delays, respects cancellation and preserves the current session settings. ([31e3c2d4b](https://github.com/berkinory/Glade/commit/31e3c2d4b60be696d86e4660566f2d3983d436cf))
- Background work remains visible, and completion notifications wait for the main task to finish. ([a3fdd6295](https://github.com/berkinory/Glade/commit/a3fdd62951bc7fbddadddca2ff189f718d05100f), [85f1c7c5a](https://github.com/berkinory/Glade/commit/85f1c7c5a6fe69d0610dc4eea11d4ea4ea8787f0))
- Keyboard shortcuts respect custom bindings, keyboard layouts and focused controls. ([1c51b91eb](https://github.com/berkinory/Glade/commit/1c51b91eb29afd325dfad4b12f0fc7554d3a9680), [3dcb8b016](https://github.com/berkinory/Glade/commit/3dcb8b016ddee352fe8a92be24e5fe0269937ed1))
- Git actions keep their workspace ownership, and chats retain pull request associations when a shared checkout changes branches. ([7419ae569](https://github.com/berkinory/Glade/commit/7419ae5692ad91f359ae25606bf15567cec377f5), [d89b6cb7b](https://github.com/berkinory/Glade/commit/d89b6cb7bf8ee41f296695b7291ab500e0017d85))
- Explorer reflects external file changes and removes deleted files from search results. ([d93f9c1f7](https://github.com/berkinory/Glade/commit/d93f9c1f778b6d33b83b8a221e32f7cecf1500c2), [272b17ff0](https://github.com/berkinory/Glade/commit/272b17ff02be53faa3bd40bb09110bed08298205))
- Provider updates and process cleanup work more reliably on Windows. ([385af3741](https://github.com/berkinory/Glade/commit/385af3741a9c15ccb81bc59a75113dca3210606b))
- Subagent transcripts and status stay synchronized across parent turns, with reliable stopping and fewer duplicate activity rows. ([85f1c7c5a](https://github.com/berkinory/Glade/commit/85f1c7c5a6fe69d0610dc4eea11d4ea4ea8787f0), [3457f46e0](https://github.com/berkinory/Glade/commit/3457f46e0a187f2932a4ed57a64738efbc1cecd5))
- Worktree preparation stays reachable when switching chats, and sends preserve newer text and attachments added while preparation is running. ([c58efa7d2](https://github.com/berkinory/Glade/commit/c58efa7d2ea5a0a60332dd425fcda43e41f471c6))
- Activity remembers its project filter, and unread chats retain their status after restarting Glade. ([b1c843277](https://github.com/berkinory/Glade/commit/b1c8432777cbb6849650f313b04cd8835467b36e))
- Temporary model discovery failures preserve the last available model list. ([4c606b49a](https://github.com/berkinory/Glade/commit/4c606b49a2d41d897d59595d817351443e2e939c))
- Desktop notifications retain their chat actions, and background errors open the affected conversation. ([a3fdd6295](https://github.com/berkinory/Glade/commit/a3fdd62951bc7fbddadddca2ff189f718d05100f))
- Git message generation reports failures clearly instead of silently substituting a generic message. ([ab97de7a9](https://github.com/berkinory/Glade/commit/ab97de7a92c0a0bbfe4f4184ee133b7d87a34787), [7419ae569](https://github.com/berkinory/Glade/commit/7419ae5692ad91f359ae25606bf15567cec377f5))
- File downloads and chat exports preserve accented characters and emoji in filenames. ([272b17ff0](https://github.com/berkinory/Glade/commit/272b17ff02be53faa3bd40bb09110bed08298205))
- Profile activity dates stay correct across time zones, and older usage keeps its original model attribution. ([19a15c164](https://github.com/berkinory/Glade/commit/19a15c1640297a484687fa1b67a96e8d3d79ea68), [6fa09d682](https://github.com/berkinory/Glade/commit/6fa09d6826b171d6629dedae47095f79c49f7bdb))
- Closing workspace tabs returns to the most recently used tab; closing a split terminal preserves the other shells. ([baeefe9e9](https://github.com/berkinory/Glade/commit/baeefe9e947fa831e5ff30619e5958ffdc19b7a5), [728ab177e](https://github.com/berkinory/Glade/commit/728ab177efe9c36ab6dcbdd4c4d19ba616a14e5e))
- Losing the launcher output connection no longer closes the desktop app. ([b8cc658cb](https://github.com/berkinory/Glade/commit/b8cc658cb5b09829bb44771450b7da591d9f3e8d))

### Removed

- Importing projects and conversations from Codex and Claude Code was removed. ([72259e088](https://github.com/berkinory/Glade/commit/72259e088f6226f2fc8ca6efd93fb2eb6e0ad6a9))
- Saved project actions, automatic worktree setup scripts and project Run controls were removed. ([7324430d2](https://github.com/berkinory/Glade/commit/7324430d2138e4be1393222452015a62c124e17a))
- Built-in pull request management and Ask why actions were removed; pull request links open externally. ([18212a60b](https://github.com/berkinory/Glade/commit/18212a60b380e8ec414ae4875bf7d6018845a1de))
- The subagent prompt command was removed; request delegation naturally in the main conversation. ([85f1c7c5a](https://github.com/berkinory/Glade/commit/85f1c7c5a6fe69d0610dc4eea11d4ea4ea8787f0))

## 0.1.1 - 2026-10-01

### New

- Settings show desktop notification permissions and let you request access or open system settings. ([76c95e3e9](https://github.com/berkinory/Glade/commit/76c95e3e9a6f8564ac8a8719af4db59984893320))

### Improved

- Settings have clearer groups and search, with provider configuration together in one place. ([41fc24a8b](https://github.com/berkinory/Glade/commit/41fc24a8ba7b7ff62e5b1a9060bbcd90f541e3be), [76c95e3e9](https://github.com/berkinory/Glade/commit/76c95e3e9a6f8564ac8a8719af4db59984893320), [83fa740a4](https://github.com/berkinory/Glade/commit/83fa740a44e335105d3da3d0a16486d410dec945))
- New chats load model choices faster and start with the provider’s latest model. ([4aff2b1a5](https://github.com/berkinory/Glade/commit/4aff2b1a5a556cf9ddab43ad91007dbf487fa358), [b1473ad4a](https://github.com/berkinory/Glade/commit/b1473ad4aed852a9b2021e6eabe7a082b70b64b6))
- Explorer hides system clutter and dims ignored files, with an option to hide them. ([7450c8a9a](https://github.com/berkinory/Glade/commit/7450c8a9adc28f6641e197b68ed87e677e2a2069))

### Fixed

- Closed security vulnerabilities in embedded browsing and provider configuration parsing. ([9e7565f3d](https://github.com/berkinory/Glade/commit/9e7565f3d6dde13e4fca209a251b64f1b37f215f))
- Replies finish reliably, and switching chats preserves pending messages. ([58d53913e](https://github.com/berkinory/Glade/commit/58d53913e556907c48c0d2194227a0481b5e87c3))
- Model thinking options include every supported level and show the provider’s actual default. ([b1473ad4a](https://github.com/berkinory/Glade/commit/b1473ad4aed852a9b2021e6eabe7a082b70b64b6), [53d891529](https://github.com/berkinory/Glade/commit/53d891529bcadee2279f3496d443b304e6f4bc55))
- Standalone Codex installations receive update notices and one-click updates. ([9992a5839](https://github.com/berkinory/Glade/commit/9992a58395437df8a6583e1b3b289decef31a27d))
- Shared Codex process warnings no longer appear as errors in unrelated chats. ([eba2fe320](https://github.com/berkinory/Glade/commit/eba2fe320c480de842bc2ecd50e47ac71e15e929))

### Removed

- Automations and scheduled chats were removed. ([632b712a4](https://github.com/berkinory/Glade/commit/632b712a4fe2a1a0d60c2e79184631be73c31c01))
- The alternative sidebar layout and project instructions panel were removed. ([83fa740a4](https://github.com/berkinory/Glade/commit/83fa740a44e335105d3da3d0a16486d410dec945))

## 0.1.0 - 2026-10-01

### New

- Approve an action that Codex auto-review denied. ([eb7837583](https://github.com/berkinory/Glade/commit/eb78375833ad3f1d5d1638e193c8db5cf081eb9a))
- Manage native MCP servers and installed provider plugins from Settings. ([748d6d5cf](https://github.com/berkinory/Glade/commit/748d6d5cfe806e3b423f8bac4128cf7594d34637))
- MCP servers can ask for form input or a browser step in both Codex and Claude. ([9f80da564](https://github.com/berkinory/Glade/commit/9f80da564c6714d7ae42ef7250e6e9885a386806))

### Improved

- Models and their options come from the connected provider, and Claude effort and speed changes apply live. ([e8adbfda4](https://github.com/berkinory/Glade/commit/e8adbfda42ab44edc3ecce4038e19a4f7d433026))
- Codex uses your existing configuration, and shared skills load natively with their bundled resources. ([e8adbfda4](https://github.com/berkinory/Glade/commit/e8adbfda42ab44edc3ecce4038e19a4f7d433026))
- Provider settings changed outside Glade stay in sync, and file changes appear live while an agent works. ([d5053b634](https://github.com/berkinory/Glade/commit/d5053b634ecf0de806463d8fd952cd900e7a3140), [eebea4ee1](https://github.com/berkinory/Glade/commit/eebea4ee177e87f655ea94cca1557d9d8da3fced))
- Chat titles come from Codex and Claude, and renames carry over to their own session lists. ([9a27e0529](https://github.com/berkinory/Glade/commit/9a27e0529ed04e443b68e63cb3ba16daec34e51a))
- Deleting a chat also deletes its provider session history, and Codex chats archive and unarchive in Codex too. ([5a763f43f](https://github.com/berkinory/Glade/commit/5a763f43f2103eb300770c5cbac8a6c9f585eced), [92732a3e2](https://github.com/berkinory/Glade/commit/92732a3e287957a3e198cb8b832e17d0702d75e7))
- Claude subagents use only your own agents, with progress and controls from Claude. ([52e4baddf](https://github.com/berkinory/Glade/commit/52e4baddf7efcffe4fc39b688a21bd36be48446c), [75499ba29](https://github.com/berkinory/Glade/commit/75499ba29f12e338df48276940abd6753a5a18d8))
- Compacting a conversation works the same way for both providers, and Claude accepts optional instructions. ([7a67e2738](https://github.com/berkinory/Glade/commit/7a67e2738809fd287d8857363c51695a34b5b4aa), [fbe18418f](https://github.com/berkinory/Glade/commit/fbe18418f9a16d7b9e3610440bbcf1b3fa4f281c))
- Codex chats share background processes and use less memory. ([e2b4c8bff](https://github.com/berkinory/Glade/commit/e2b4c8bff2a11549da0f55c340f820164ca6e02a))
- Streaming replies write far less to disk, and long code blocks stream smoothly without losing text selection. ([0cfe0c1aa](https://github.com/berkinory/Glade/commit/0cfe0c1aacebafaf4bb191c3014f621c91a50560), [ace77e5a5](https://github.com/berkinory/Glade/commit/ace77e5a5f0115e4656e7d373297760f703a7c27))
- Diffs open faster and stay responsive in large changes. ([26630491f](https://github.com/berkinory/Glade/commit/26630491fdc7c977a33e97d27ce803bcd26a2503))
- Terminals open faster and load image support only when needed. ([aa68a5b9c](https://github.com/berkinory/Glade/commit/aa68a5b9ceed3dd95a872f9b39d310069182ca22))
- The sidebar runs far fewer Git and GitHub commands, and Git status updates as soon as the repository changes. ([de41433be](https://github.com/berkinory/Glade/commit/de41433bef10fed92ed4deb41c27c2cb0109a590), [064d6e282](https://github.com/berkinory/Glade/commit/064d6e28271f013969a1da074ecdd2b512c814e0), [d43377a6a](https://github.com/berkinory/Glade/commit/d43377a6a990267c70191b15a8d8611f5278474e))
- Explorer and change lists stay fast and light in large repositories. ([c8c7e7b52](https://github.com/berkinory/Glade/commit/c8c7e7b52014f34cb786b4c82c5345c38f09fd5a), [a534ba276](https://github.com/berkinory/Glade/commit/a534ba27673be1f7e7f271bb58927869987f692d))
- File editing shows clearer line numbers, caret, active line and selection; the caret shape is configurable in Appearance, and Cmd+Y redoes edits on macOS. ([2f9639902](https://github.com/berkinory/Glade/commit/2f96399020d872b47c04e2aa88e322eb469ca7fb))
- File search and chat find show plain names in compact, clickable rows. ([ae61cbc2d](https://github.com/berkinory/Glade/commit/ae61cbc2d4515822e4d208035de5184ccf4dac83), [316ad0dc2](https://github.com/berkinory/Glade/commit/316ad0dc2d57edae695bcceb09dd65827b8f1c24))
- Project chat lists use Show more and reset when collapsed, and queued messages have clear edit and delete actions. ([aa2b7e3e3](https://github.com/berkinory/Glade/commit/aa2b7e3e3f54110b476f0c60f7fe0b8a731acae1), [338b4f7ec](https://github.com/berkinory/Glade/commit/338b4f7ec23c5335cb8d7be422feb4b76c210562))
- Development sessions can be stopped together with `bun run dev:stop`. ([eea24f94e](https://github.com/berkinory/Glade/commit/eea24f94e9d4f57a9ced8e0e3a0cf0bbd59cbdc2))

### Fixed

- Editing or reverting a message restores only its own file changes and asks before overwriting later edits. ([5217e4aae](https://github.com/berkinory/Glade/commit/5217e4aaef56c944891cf3cdb16c0487545f32fa))
- Forking from a message no longer carries later conversation into the new chat. ([fd105bd80](https://github.com/berkinory/Glade/commit/fd105bd80a0cc9ae6c91e129e115f3436bdda017))
- Computer Use and gateway rules reliably reach Codex sessions. ([48174bbc7](https://github.com/berkinory/Glade/commit/48174bbc7714e995c3088b45bcfa05c364c62fb3))
- Built-in Claude commands such as /cost and /context show their output. ([dd07529ef](https://github.com/berkinory/Glade/commit/dd07529ef96d90aa71391e6c7ca25e83b8237434))
- Images generated by Codex load from their real saved file instead of a guessed path. ([c545e809b](https://github.com/berkinory/Glade/commit/c545e809b2d5e842bf788b23e21378725def7bfa))
- Unsaved file edits stay available across navigation and are marked in Explorer. ([1c07fbc37](https://github.com/berkinory/Glade/commit/1c07fbc37ea348958280b5b676c0a99712c9a1a1))
- General search shows clear chat and project labels and keeps chat workspaces out of project results. ([316ad0dc2](https://github.com/berkinory/Glade/commit/316ad0dc2d57edae695bcceb09dd65827b8f1c24))
- Code editor search controls stay steady as match counts change. ([116b9680b](https://github.com/berkinory/Glade/commit/116b9680bda0e3350aa4c3b47262b503494cb3e0))
- Editing a sent message sends with Enter and uses standard action buttons. ([3b7dd8d11](https://github.com/berkinory/Glade/commit/3b7dd8d115ef0769e226ac9b44de7349c42dbe4f))

### Removed

- Plan mode, proposed plans, thread goals and debug mode were removed; provider permission modes remain. ([10d6a0d27](https://github.com/berkinory/Glade/commit/10d6a0d2713bc6f8b8ee8582537b8be04b1e17ce), [8c5d109e2](https://github.com/berkinory/Glade/commit/8c5d109e2349357f25851f28f746c358446708a1), [49b49937e](https://github.com/berkinory/Glade/commit/49b49937e7e4995f784ec84d6f224b424f80690d))
- The Kanban board was removed. ([3c122db07](https://github.com/berkinory/Glade/commit/3c122db072cc129e0ee7a823d7b44f02ae282a5d))
- The device simulator and its agent controls were removed; Computer Use remains. ([f5ed0905c](https://github.com/berkinory/Glade/commit/f5ed0905c7e52b2db9cf471ca66d320d8373fc84))
- Claude cache-review prompts, context overrides and the Ultrathink picker were removed; Claude Code manages context itself. ([e8adbfda4](https://github.com/berkinory/Glade/commit/e8adbfda42ab44edc3ecce4038e19a4f7d433026))
- Cursor, Grok and OpenCode providers were removed. ([604a0c3ce](https://github.com/berkinory/Glade/commit/604a0c3ceaf4ead71fffc203970b03f4e9be41df))
- The standalone Pull Requests page and the separate editor view were removed; editing stays in Explorer. ([b13a0569f](https://github.com/berkinory/Glade/commit/b13a0569f17534f8e663472a17d5523343198a61), [01b3a6ccf](https://github.com/berkinory/Glade/commit/01b3a6ccf27073ca22e8959a68c6bc1a6c4f2fe5))
- Data from 0.0.x previews is not carried over. Glade 0.1.0 refuses to open a preview database; move `state.sqlite` out of the Glade data folder to start fresh. ([7a8a22f63](https://github.com/berkinory/Glade/commit/7a8a22f63347e6bfd15edf03a005acbe5d53905b))

## 0.0.5 - 2026-09-29

### New

- Search workspace contents from Explorer, filter matches, and jump directly to the matching line. ([d827cfdd2](https://github.com/berkinory/Glade/commit/d827cfdd2cf5c5826c2926b6a1796106154982b4))
- Create, rename, and delete files and folders directly in Explorer. ([893378876](https://github.com/berkinory/Glade/commit/893378876700e32cc81cd2921d1edc7a29152361))
- Commit staged changes, switch branches, fetch, pull, push, and manage rebases from Source Control. ([f51193d55](https://github.com/berkinory/Glade/commit/f51193d55340088197ecf9b09267f3a29a0b2b1e))
- Browse and search commit history, inspect file diffs, and see branch and tag references. ([c020041a0](https://github.com/berkinory/Glade/commit/c020041a02764e2276d90111fe5665a502fba982), [7829610e2](https://github.com/berkinory/Glade/commit/7829610e24703fdbe537fe73ab99f39e3bea69d7))
- Generate commit messages from staged changes with AI. ([f51193d55](https://github.com/berkinory/Glade/commit/f51193d55340088197ecf9b09267f3a29a0b2b1e))
- Stage, unstage, or revert multiple files together in Source Control. ([40352945d](https://github.com/berkinory/Glade/commit/40352945d5e7f8314bd4da7bf53b222d98fa2430))
- Add untracked files and folders to .gitignore from Source Control. ([f51193d55](https://github.com/berkinory/Glade/commit/f51193d55340088197ecf9b09267f3a29a0b2b1e))

### Improved

- Large files now use the full editor with in-file search; save edits explicitly with Cmd/Ctrl+S. ([12e24d1cd](https://github.com/berkinory/Glade/commit/12e24d1cd08d805508ad398b2550eac19245d90f), [893378876](https://github.com/berkinory/Glade/commit/893378876700e32cc81cd2921d1edc7a29152361))
- Workspace tools share a resizable sidebar, with chat terminals alongside Explorer and Source Control. ([3a0a6c227](https://github.com/berkinory/Glade/commit/3a0a6c2279c0fcf394d6654ea647ebe849a2173c))
- File and folder icons are consistent across workspace tools, attachments, and code blocks. ([eacb74af6](https://github.com/berkinory/Glade/commit/eacb74af620fe53b492da2d1d2bdda2d382906d0), [7c3b08f8f](https://github.com/berkinory/Glade/commit/7c3b08f8fbfa6f54c4e376bfc4d41f00c971f8f3))

### Fixed

- Editing messages preserves conversation history and staged changes without rewriting unchanged files. Stopped replies remain editable. ([655214630](https://github.com/berkinory/Glade/commit/65521463052bb8c3b383269eaa2173fe9d76ab10))
- Provider reconnects keep the composer available, and previously blocked chats recover after restarting. ([655214630](https://github.com/berkinory/Glade/commit/65521463052bb8c3b383269eaa2173fe9d76ab10))
- Replies stay in place as thinking turns into text, and delayed session updates no longer flicker the send controls. ([bb24cd2cc](https://github.com/berkinory/Glade/commit/bb24cd2cc3f3b2b2b0e0fa4e0b5c2b55328660e5))

## 0.0.4 - 2026-09-28

### Removed

- Studio mode and its dedicated workspace flows were removed. ([648d50fb1](https://github.com/berkinory/Glade/commit/648d50fb1194ffe60e273cf07407231eb6e5d910))
- Environment recaps and their background model requests were removed. ([971784b30](https://github.com/berkinory/Glade/commit/971784b305809ea4d0e02392853874d9b119727d))
- New-worktree handoff and separate provider handoff controls were removed. ([177bf8085](https://github.com/berkinory/Glade/commit/177bf808538d03182e0368fc02151debdfd559ed))
- Sidebar customization and the Docs link were removed; feedback now opens the issue form. ([419ef9b1c](https://github.com/berkinory/Glade/commit/419ef9b1c541a9c82612f1322acf865f14af6373))

### Improved

- The model picker shows connected providers, keeps a steady height, and confirms cross-provider handoff with the chosen model. The new chat shows the transition. ([177bf8085](https://github.com/berkinory/Glade/commit/177bf808538d03182e0368fc02151debdfd559ed), [01f2e8624](https://github.com/berkinory/Glade/commit/01f2e862442ce63cbda03983f3a9d1c4584200c8))
- Settings can check, download, and install desktop updates. ([14381fb8c](https://github.com/berkinory/Glade/commit/14381fb8cb07f16cdd725fe7177760d674ef268d))
- Branch and project pickers use compact menus; branch actions show diff totals without duplicate usage. ([341bd13f8](https://github.com/berkinory/Glade/commit/341bd13f8b43d4a2ad3546d11338cdaa412a9cbf), [953df655e](https://github.com/berkinory/Glade/commit/953df655e527cbf5aa015b987d006f6c63868e81))
- The sidebar has a width limit, smoother resizing, and compact shortcut hints that do not overlap badges. ([f254913a5](https://github.com/berkinory/Glade/commit/f254913a581ab68a112e2a6022938145e70565ba), [13d85c71f](https://github.com/berkinory/Glade/commit/13d85c71fe7c45b089e51fbf7c0c6f828290bfd6), [3df97a78d](https://github.com/berkinory/Glade/commit/3df97a78d11c7dd75c4b86856cefa7a3711cf5fd))
- Tooltips open after 300 ms; message action icons sit closer together. ([1760eee7f](https://github.com/berkinory/Glade/commit/1760eee7fa5ddfb6ab6578c17d0dd2a15760a9eb), [4beac45f9](https://github.com/berkinory/Glade/commit/4beac45f9344f508c3a4abc691a78e17f556bc04))
- Menus, panels, and project lists animate more consistently. ([fb63366e7](https://github.com/berkinory/Glade/commit/fb63366e7051ddc191305f5766cb766dbd067db7))
- What's new groups release notes by change type and shows a simpler preview. ([60cd9847f](https://github.com/berkinory/Glade/commit/60cd9847fdaea45ad448b6922fb1c43d1906f54b))

### Fixed

- Sending a message resumes a chat blocked by an earlier provider failure. ([f4d3d63fe](https://github.com/berkinory/Glade/commit/f4d3d63fee922c3433bfb65863c97d2fb45eac73))
- Pull requests use the project's primary GitHub repository; ordinary folders no longer show a repository warning. ([8c2149b62](https://github.com/berkinory/Glade/commit/8c2149b6270ea2ad3b8f34857f90669d40f8ebc0))
- Existing Studio folders remain available as normal projects after upgrading. ([fdcc171f5](https://github.com/berkinory/Glade/commit/fdcc171f51d6d5cae3b8c0db400cd591eba59daf))
- Saved shortcuts for retired terminal threads are cleaned up. ([254650b8d](https://github.com/berkinory/Glade/commit/254650b8de5e63dcd6be79b8cc3cc9e6d8d7dc1d))
- The macOS Check for Updates menu item has an icon. ([0785150a1](https://github.com/berkinory/Glade/commit/0785150a1fab59f17f7c708fe847246822b24e5d))

## 0.0.3 - 2026-09-28

### Removed

- Terminal threads; sidebar terminals remain. ([369d22a3a](https://github.com/berkinory/Glade/commit/369d22a3af988562a18f2e61f939f22fba74b91d))
- Temporary chats and their delete-on-leave behavior. ([d6d52c897](https://github.com/berkinory/Glade/commit/d6d52c8971bb0592d208acf16f7d9801fbea51b6), [85f9a3bb5](https://github.com/berkinory/Glade/commit/85f9a3bb56a6b14ba6addc35307b49da9f34f59c))
- Side chats and the `/side` command. ([41365fa0f](https://github.com/berkinory/Glade/commit/41365fa0fd2157a8572ab89b186d1401d45dc35d))

### Improved

- Source control combines staging and Review in one panel. ([a9e7cc009](https://github.com/berkinory/Glade/commit/a9e7cc0098785d81584c282210c02caa9a1c0236))
- Menus, dialogs, panels, and disclosures use consistent motion. ([718ba5c2a](https://github.com/berkinory/Glade/commit/718ba5c2a2e77f633403a17a7b8b4b87a6786591))
- The unfiled Space is now Home. ([3a0f38488](https://github.com/berkinory/Glade/commit/3a0f384885c131b1162bd3daa5ba11e960452863))
- Desktop windows now have a 1024×700 minimum size. ([3dcfe2a39](https://github.com/berkinory/Glade/commit/3dcfe2a394ad0d31edc008bcf08cab6149f21bcc))

### Fixed

- Provider and validation errors show useful messages instead of stack traces. ([7d1b30df3](https://github.com/berkinory/Glade/commit/7d1b30df360c029d467dd9d18dd2fc61be68c7ac))
- Chats stay in their assigned Space; empty Spaces preserve their own drafts. ([3a0f38488](https://github.com/berkinory/Glade/commit/3a0f384885c131b1162bd3daa5ba11e960452863), [780c94437](https://github.com/berkinory/Glade/commit/780c944373c99210e99a840e6f1d1fc6d2d55797))
- Replies without file edits no longer show an Undo control. ([3a0f38488](https://github.com/berkinory/Glade/commit/3a0f384885c131b1162bd3daa5ba11e960452863))
- Chat transcripts, pull request filters, and Settings sections keep their layout stable. ([38986b715](https://github.com/berkinory/Glade/commit/38986b71533add3ef3dc847e43ce45e1ccfb1c80), [64d31759c](https://github.com/berkinory/Glade/commit/64d31759c5faa40a61f85b2e94e1a071877cd40e))
- Terminal tabs recover from temporary connection failures. ([abb659c60](https://github.com/berkinory/Glade/commit/abb659c601732013ee93653c42f4decdd9c54a1a))
- Cursor checks no longer open a login browser, and provider warnings wait until the provider is used. ([fb410b293](https://github.com/berkinory/Glade/commit/fb410b2937d5ef77c8835ab7a45728a37d8149e6))
- Onboarding no longer advertises external agent pairing. ([070d59211](https://github.com/berkinory/Glade/commit/070d59211a1d1669ab19bfd569311b5331b30c89))

## 0.0.2 - 2026-09-28

### Improved

- macOS downloads now match Apple Silicon and Intel separately, with architecture-aware automatic updates and Homebrew installation.
- Desktop downloads are smaller after removing unused bundled Claude CLI binaries and a duplicate Computer Use driver.
- Release builds reuse verified main CI results and prepare native driver caches before publication.

## 0.0.1 - 2026-09-27

### New

- Initial launch with five providers: Codex, Claude Code, Cursor, Grok, and OpenCode.
