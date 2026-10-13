# Glade Changelog

## Unreleased

### New

- OpenCode, Grok Build and Cursor are available as providers, including OpenCode's free models. Their models, each model's own effort levels and their native slash commands appear in the composer, their chats get generated titles, they can write commit messages, pull requests and branch names, and Supervised mode asks before they edit files or run commands. Their chats can be forked, compacted, edited and rewound, and Usage & limits shows Cursor, Grok and OpenCode Go limits from your own sign-in.
- Chats stopped by a usage limit continue on their own once the limit resets. Cancel the wait from the chat, or turn it off in Settings.
- The Environment panel lists the chat's background tasks, such as test runs and builds, with how long they have run, and can stop them. A server an agent starts shows once, under Local Servers, marked with the chat and task that started it.
- One Update all button in the sidebar updates provider CLIs on this computer and every connected host, then installs the Glade update. Running chats can resume automatically after the restart, and hosts get the new version when they reconnect.

### Improved

- Finished shell commands say how they went next to their name: test totals such as "451 passed" or "2 failed, 449 passed", type and lint errors, the number of search matches, or the line that explains a failure.
- Search commands list their matches in the details, and each one opens its file at that line.
- A read of part of a file shows the lines it covered, such as "L20–40", and opens the file there.
- A file a shell command changed can be opened in the turn's diff from the command's details.
- The same command run several times in a row shows once, with how many times it ran and its latest result.
- Model search ignores case, spacing, punctuation and word order, so "gpt5" finds GPT-5.
- Typing @ suggests only a few recent chats from the current project, below files and agents, and no longer lists subagent chats. Type a name to search more.
- Shell commands that write files read as edits: a Python or JavaScript script that writes a file, `sed -i`, `perl -pi` and `cat > file` show "Edited", "Wrote" or "Appended to" with the file, and count as edited files in their tool group.
- Scripts show their language's icon, such as Python, Node or Bun, and code passed to a command through a heredoc is highlighted in its own language under the command.
- Several searches in one command say what they looked for and where, such as "Searched for visibility, LevelDto +3 in Game/Runtime", instead of "Searched 2 times".
- Glade starts faster and uses much less memory, and Codex replies take far less work to process.
- Long Claude sessions use less memory.
- Searches in tool calls say what they look for in plain words and count every folder they search.
- A shell command that reads files shows them like a Read tool call: one file as its file chip, several as a count with each file listed in its details to open with a click, and every one counted in its tool group.
- Retried requests to a provider show as one row with an icon and the latest attempt, such as "Connection lost · retry 5/10", and open to every attempt.
- A command left running in the background says so on its own row and updates when it finishes, fails or is stopped, instead of adding a separate "Moved to background" row.
- The visual reply preview browser loads only when a preview is first needed, so Glade starts lighter.
- Busy terminals use less CPU.
- The agent browser uses less memory: at most four tabs stay loaded, and idle tabs in chats you are not looking at unload sooner.
- Glade opens faster: its local server now starts before other startup work.
- The Dock icon uses less memory on macOS.
- Live activity labels use less CPU while agents work.
- Diffs use less memory, and it is freed once diffs have been closed for a while.
- Opening a busy chat or starting Glade no longer downloads the same data twice, and live chats stop polling while updates stream in.
- Long chats stay smoother while a reply streams.
- The branch picker and subagent list do less work while a reply streams.
- Chats open faster: math, file previews and code reviews load the first time they are needed.
- Long chats open faster, and opening one no longer pauses other chats' streaming.
- Tool output takes much less space in the local database.
- The local database drops replay records it no longer needs, and its write log shrinks back after large writes.
- Streaming replies do far less database reading per update.
- Server memory no longer grows with every chat used during a session.
- Running chats write far fewer status updates, so the sidebar and server stay calm during long turns.
- Streaming replies write far less to disk and send fewer updates, with the same text.
- Codex subagent progress refreshes no longer re-read the subagent's whole conversation.
- Large file writes and edits from Claude no longer slow Glade down while their input streams.
- On macOS, Glade no longer re-applies its app icon on every launch, so it starts quicker.
- Long replies stream smoothly, and switching back to a recent chat renders its messages faster.
- Finishing a turn no longer re-downloads the whole chat, so long chats stay responsive when an answer lands.

### Fixed

- Opening an edited file's diff from a tool call shows that file instead of the whole turn when the tool named it with a full path.
- Long command output keeps its last lines, where test totals and errors usually are, instead of only its first.
- A visual reply that arrives while a reply streams no longer sometimes says it tried to navigate away.
- An approved request no longer leaves an extra unnamed tool row in the chat.
- After a chat switches to another provider, the new provider can use Glade's tools from its first reply.
- Editing a message or rewinding a chat no longer plays the turn finished sound or shows a completion notification.
- Progress updates from background tasks and subagents no longer appear in the chat as "Reasoning update" rows; their cards and the Environment panel show them.
- Forking a chat from an earlier reply works while the chat is still running. Only the reply that is still being written cannot be forked, and its fork button stays hidden until it finishes.
- Opening the rewind or edit confirmation no longer expands and collapses the previous reply.
- Live change counts no longer touch the Git index while an agent works, which could make the agent's own Git commands fail.
- Chats in folders that are not Git repositories no longer retry Git every few seconds, and running git init in one is picked up right away.
- A chat whose turn changed thousands of files no longer slows down typing and switching chats. Long file lists in chats, diffs, commits and restore prompts show a page at a time.
- SSH hosts and Linux servers no longer freeze for seconds when an agent rewrites many files, and watching a large repository there takes far less memory.

## 0.2.5 - 2026-10-13

### New

- Add a project from GitHub on an SSH host or a paired machine; the repository is cloned on that machine. ([b9e3ccd47](https://github.com/berkinory/Glade/commit/b9e3ccd47c929bffe1bff1b9ec132e9b1a9d4ca2))
- Rewind a chat to any of your messages, or edit one, and choose whether the files changed since then are kept or restored. Glade warns when another chat worked in the same folder in the meantime. ([5feb95884](https://github.com/berkinory/Glade/commit/5feb95884f37d590807f6f1074971af98a2a156f))

### Improved

- Switching providers is instant: your next message carries the conversation over, switching back before sending undoes it, and returning to a provider resumes its own session. ([3f4a20981](https://github.com/berkinory/Glade/commit/3f4a209819665e3ee9be9b00306064457654f788), [11efe0c1d](https://github.com/berkinory/Glade/commit/11efe0c1d3b57375dbf26a1bec6dfa131d978f30))
- The composer has separate model and settings pickers next to the add button, and number shortcuts pick the thinking effort. ([a23f8cea5](https://github.com/berkinory/Glade/commit/a23f8cea5993f9e1288b2b5e46eda0202b18fe90), [e68c0d8f3](https://github.com/berkinory/Glade/commit/e68c0d8f3eefec69dde6592a940503104cccab21), [09fce1006](https://github.com/berkinory/Glade/commit/09fce100619327e512f31d0572cac01f139e0edd))
- A new app icon. ([a82e75efe](https://github.com/berkinory/Glade/commit/a82e75efec8979c20911fa3d2ef0b412b3423556))
- Tool calls are easier to read: shell commands are named by what they do, commands and their output sit in separate boxes, and calls without details no longer open. ([388e34c7f](https://github.com/berkinory/Glade/commit/388e34c7f20d07e83fc9cb6730785223f39311ec), [b1373d376](https://github.com/berkinory/Glade/commit/b1373d376b207a4412ee218f54e14ec2947988be), [10aed864b](https://github.com/berkinory/Glade/commit/10aed864b7ef8abf0533d2b502cb0eb7b8958098), [46a8f0d4d](https://github.com/berkinory/Glade/commit/46a8f0d4d70fdb55cf585ee00e7b8cb238ad48b1))
- Thinking gets its own row that shows how long the agent thought. ([fe278b4f1](https://github.com/berkinory/Glade/commit/fe278b4f1ab352d221cca38864d24acd79c49d75))
- A turn's edited files list stays compact, scrolls when it is long, and remembers whether you keep it open. ([da52c2bb6](https://github.com/berkinory/Glade/commit/da52c2bb6ad7eaef2f43abbc08bb26e70b78dc46), [748f0161a](https://github.com/berkinory/Glade/commit/748f0161aaef0cad1d96b3a5e36a016571111baa), [4c235f254](https://github.com/berkinory/Glade/commit/4c235f2547d6ef721633e7a933313b38d0d18f3f))
- When a finished turn still waits on a subagent or background command, the end of the chat shows what it is waiting for. ([d7b2af061](https://github.com/berkinory/Glade/commit/d7b2af061ad5eee509688b36e6e9bf89390b2c92))
- Everything that opens and closes in the chat moves the same way, and loading indicators are clearer and differ by the kind of work. ([0e365e9bd](https://github.com/berkinory/Glade/commit/0e365e9bdcf85c7b6b703430c790b9300a0166e9), [ad75e1f05](https://github.com/berkinory/Glade/commit/ad75e1f05b4cf354e99c7b791a00b8b100da6536))

### Fixed

- The chat keeps following a running turn through tool activity and approvals until you scroll away. ([d4bcb4760](https://github.com/berkinory/Glade/commit/d4bcb47607143cec362a4420c0ef9b4ac9c364b6), [fd2b47336](https://github.com/berkinory/Glade/commit/fd2b47336665b1402b998f164437ddca9242be0f))
- Background subagents and commands no longer add empty turns, split a turn in two, mislabel the reply that follows them, or mark a chat as done or failed too early. ([27166080a](https://github.com/berkinory/Glade/commit/27166080a555fde1bef3628f1d35b81dca32ebc2), [0c871f566](https://github.com/berkinory/Glade/commit/0c871f56674da09c1fdd1d6b442a99d4b228e189), [d7b2af061](https://github.com/berkinory/Glade/commit/d7b2af061ad5eee509688b36e6e9bf89390b2c92), [7b10ee145](https://github.com/berkinory/Glade/commit/7b10ee1454733cf4586425b6b120e77832956e69))
- Opening a subagent's chat shows its whole conversation at once instead of the prompt first. ([7eabcae24](https://github.com/berkinory/Glade/commit/7eabcae24a4aedb84bd71205441f3a3ccf7b8fc8))
- Forked chats keep their visual replies, pinned messages, attachments and full history, and resume their own session. ([6eb38d2a2](https://github.com/berkinory/Glade/commit/6eb38d2a2c100d0c03be795b2bb410e43c031521), [b20567f44](https://github.com/berkinory/Glade/commit/b20567f44693311a72d097e4fe816fc2814f6a7d), [03ee96c28](https://github.com/berkinory/Glade/commit/03ee96c284901a48b25f9d4a0cdfab87b2fc3564))
- Archiving or deleting the open chat moves to the next chat in the project instead of a subagent or an archived chat. ([11912b95c](https://github.com/berkinory/Glade/commit/11912b95c65772e7b9989d72623fd9013ddf9de1))
- A new chat's model picker lists Claude models instead of a launch error before the chat's folder exists. ([a270e624d](https://github.com/berkinory/Glade/commit/a270e624d3e0961d05fb222007ab4c8af4288d38), [a938cd012](https://github.com/berkinory/Glade/commit/a938cd012b15b752e5751f00ed256f3f4ce7e996))
- Sending a message whose attached file was moved or deleted drops that attachment and tells you, instead of failing. ([4ffa5a567](https://github.com/berkinory/Glade/commit/4ffa5a56748713fabdcd7ff2ebbb2c85e0b68310))
- Images in replies show on their own line at a readable size. ([bbb6c87a5](https://github.com/berkinory/Glade/commit/bbb6c87a51f36a95570a7a9ef1c17e71e1faf993))

### Removed

- The subagent list above the composer. Subagents show in their card in the chat, which can stop them all, and in the Environment panel. ([742ab0f7c](https://github.com/berkinory/Glade/commit/742ab0f7cc300425022b764d9973ed218c5e3cc6))
- The large tooltip on tool calls; their details open in place. ([fe278b4f1](https://github.com/berkinory/Glade/commit/fe278b4f1ab352d221cca38864d24acd79c49d75))
- The Open PR in browser action in the pull request dialog. ([e9a8cdfd9](https://github.com/berkinory/Glade/commit/e9a8cdfd941877293bed259908e8a23e0fd07f1b))
- Starting a new worktree from the latest remote branch. New worktrees start from the local branch and can still copy uncommitted changes. ([ac3b64bf0](https://github.com/berkinory/Glade/commit/ac3b64bf00fa21ef4f1b2f0074e17cff27aae825))

## 0.2.4 - 2026-10-12

### New

- Pull requests get their own screens: browse a project's pull requests from the right sidebar and open any of them in a tab with its summary, checks, reviews, comments and changed files. ([4754881a0](https://github.com/berkinory/Glade/commit/4754881a0215649c1c5f12537fbd2960f8833df8), [1076c8a36](https://github.com/berkinory/Glade/commit/1076c8a36f0b177f89af1ebfd24ebcdd3bf15cd4))
- Pull requests in the Environment panel show their checks and review comments and offer the next step: fix failing checks, conflicts or review feedback with the agent, update a branch that fell behind, mark a draft ready, or merge. ([66a61f3c4](https://github.com/berkinory/Glade/commit/66a61f3c4e00880ab03dcc36cc7f383b147351d5))
- Failing GitHub Actions checks show the end of their log next to the check, failed jobs can be rerun, and Fix hands the agent the failing log. ([4754881a0](https://github.com/berkinory/Glade/commit/4754881a0215649c1c5f12537fbd2960f8833df8))
- Choose whether a new worktree copies your uncommitted changes or starts from the latest version of its branch on the remote. ([577d932fb](https://github.com/berkinory/Glade/commit/577d932fb81f05a0d21722dd8c984b02bd9fca1b))
- Worktrees of archived chats can be cleaned up automatically once their pull request is merged or after a chosen number of days. ([1117a5e67](https://github.com/berkinory/Glade/commit/1117a5e6701c9c0f4332b7c8ae7ada26e271c871))
- Each turn shows how long it worked and whether it finished, was stopped or failed. ([c8e72acb0](https://github.com/berkinory/Glade/commit/c8e72acb0d9c08168e584f995eb89e9263f3767b))
- Answered agent questions stay in the conversation together with your answer. ([3f498be92](https://github.com/berkinory/Glade/commit/3f498be921458a225d51f93fb02c76cc336e810f))
- What's new and the changelog show a visual overview for releases that have one. ([75dd9f026](https://github.com/berkinory/Glade/commit/75dd9f02613ba98dea05b3b022ad68eac8d727bb))

### Improved

- Queued messages pause after a turn is stopped or fails, with options to resume or edit them. ([53e16e56d](https://github.com/berkinory/Glade/commit/53e16e56d2569471f75c6e5b37b95598c1679649))
- The Git button always shows the next step for your branch and why it is unavailable, Source Control has a single sync button and Commit & push, and new branches are published on their first push. ([fec393a65](https://github.com/berkinory/Glade/commit/fec393a65384ee4d3f8cf8b91425a6ffa052ebdf))
- The commit dialog starts from your staged files and shows line counts per file. ([fec393a65](https://github.com/berkinory/Glade/commit/fec393a65384ee4d3f8cf8b91425a6ffa052ebdf))
- GitHub data loads directly from GitHub instead of through the GitHub CLI, using far fewer requests and pausing background refreshes before the rate limit runs out. Settings show whether the GitHub CLI is installed and signed in. ([4754881a0](https://github.com/berkinory/Glade/commit/4754881a0215649c1c5f12537fbd2960f8833df8), [66a61f3c4](https://github.com/berkinory/Glade/commit/66a61f3c4e00880ab03dcc36cc7f383b147351d5))
- GitHub avatars appear in Source Control history, pull request comments and the Publish to GitHub dialog. ([4754881a0](https://github.com/berkinory/Glade/commit/4754881a0215649c1c5f12537fbd2960f8833df8))
- Deleting a worktree from Settings keeps a snapshot of it for 30 days. ([4754881a0](https://github.com/berkinory/Glade/commit/4754881a0215649c1c5f12537fbd2960f8833df8))
- Subagents launched together share one card in the chat with each one's live progress, result and usage, and can be opened or stopped from it. When Claude resumes a finished subagent, the follow-up shows in its own chat. ([17e120520](https://github.com/berkinory/Glade/commit/17e12052051fc3618f9ae81ea61cbdbe2bbe94f7), [f508f9ca4](https://github.com/berkinory/Glade/commit/f508f9ca427eeba8cfbc393c7419d15ddf4ed12b))
- Subagent lists collapse to a compact row of avatars with running and done counts, and subagents sit under their parent chat in the sidebar. ([4d6193784](https://github.com/berkinory/Glade/commit/4d6193784078893e47cacfa6b89c756a2728587c), [54f84015c](https://github.com/berkinory/Glade/commit/54f84015c31906f98212e4c12623199de3e93a48))
- Tool calls open to show what the agent sent and what came back, formatted for the kind of result, and groups of calls get short titles and icons that say what the agent did. ([c3acd300f](https://github.com/berkinory/Glade/commit/c3acd300ff4511f4a8b68cfec88eb09d80189534), [0cdc54b65](https://github.com/berkinory/Glade/commit/0cdc54b65e34f0b19f199a8d0f64c5e7d6ff104f), [64bdac1ec](https://github.com/berkinory/Glade/commit/64bdac1ec18cac803bc8df726051752ded266b7f))
- Long tool output keeps much more before it is shortened. ([17d672da8](https://github.com/berkinory/Glade/commit/17d672da87551f200f3176c9a51fbb2dbe0d4966))
- Claude chats show the Monitor event that woke the agent. ([563a470dc](https://github.com/berkinory/Glade/commit/563a470dc085552d178b1f2b17d7bcf242b360b3), [a83d3f073](https://github.com/berkinory/Glade/commit/a83d3f07376ae5c2de866dfaa58a35a91f37c8f1))
- Opening a file from the chat, file search or Source Control no longer switches the right sidebar to the Explorer. ([493dc458b](https://github.com/berkinory/Glade/commit/493dc458bb102702f4bfe1d881a4f7a50786de48))
- File and content search shortcuts can be changed, and file search opens pasted paths directly. ([f4632a6bb](https://github.com/berkinory/Glade/commit/f4632a6bbac749254012e6ef40167917895da4e6), [cb811413e](https://github.com/berkinory/Glade/commit/cb811413ed96ef6588dec47d722d117ea013690c))
- Markdown previews render embedded HTML safely, and right-to-left text displays in the correct direction. ([8d7ac5e74](https://github.com/berkinory/Glade/commit/8d7ac5e74ac0fe754d2eab5510ce64de0bed957b), [9812480f4](https://github.com/berkinory/Glade/commit/9812480f47d0fd0e06ec12cb078214153d12c6cb))
- The Help menu opens the full changelog from a single item. ([75dd9f026](https://github.com/berkinory/Glade/commit/75dd9f02613ba98dea05b3b022ad68eac8d727bb))

### Fixed

- Automatic worktree cleanup never removes a worktree it cannot read and never deletes commits that exist nowhere else. ([1117a5e67](https://github.com/berkinory/Glade/commit/1117a5e6701c9c0f4332b7c8ae7ada26e271c871))
- Committing selected files no longer discards changes you staged in Source Control. ([f95f79a35](https://github.com/berkinory/Glade/commit/f95f79a35fcdff3b648ad30c876a70aff1b579f5))
- Stopping, restarting or losing an agent no longer leaves chats stuck as starting, running or streaming, and stopped turns no longer reappear as completed. ([9af394adf](https://github.com/berkinory/Glade/commit/9af394adff71b281b54fa85da0481aba05b1292a), [cf2ea67dc](https://github.com/berkinory/Glade/commit/cf2ea67dce00b6665e17495f2d238c6243327568), [c042efad5](https://github.com/berkinory/Glade/commit/c042efad5a05089ac7d97cf7744de506c2c460db), [c4ca5a6af](https://github.com/berkinory/Glade/commit/c4ca5a6af7f32aa1498ea2fcff869d1983109a1b), [1e8110868](https://github.com/berkinory/Glade/commit/1e811086825df161fed3194e24870dce1a7eb82d))
- Chats stay in sync after reconnects without flickering, duplicated text, missing reply endings or replies shown out of order. ([4a235e276](https://github.com/berkinory/Glade/commit/4a235e276795dc039d9e46a383bebb9e11b73c42), [2feafa9fd](https://github.com/berkinory/Glade/commit/2feafa9fd5fae4ba4cb175bd85b5be98405e02b3), [d2a553582](https://github.com/berkinory/Glade/commit/d2a553582c0834f89c5742fc1290e6c28b957e8b), [45d65211d](https://github.com/berkinory/Glade/commit/45d65211dfe39fa0abfa086a53947cecf33c3799), [123a94f18](https://github.com/berkinory/Glade/commit/123a94f18d971f83a9a9fd6b67c5f1bc77e7cf0c), [26858e799](https://github.com/berkinory/Glade/commit/26858e799d17af5fa15d8456d49f80bc3b20d0e6))
- Scrolling up to read earlier messages no longer jumps you back to the end of the chat. ([c240bc078](https://github.com/berkinory/Glade/commit/c240bc0788086df3b7f0b330fe56d31b21230d39))
- Questions from a stopped agent no longer come back as unanswered, and a crashed agent no longer locks the message box. ([4806a6af0](https://github.com/berkinory/Glade/commit/4806a6af025c2f21801e394e84fbe721ae7a4982), [8b207f3e8](https://github.com/berkinory/Glade/commit/8b207f3e87929e894b4ce7fecfeb250e5013c1bf))
- Sent messages leave the composer right away and no longer get stuck in front of the text you type next. ([e76fa3452](https://github.com/berkinory/Glade/commit/e76fa3452c468336e88f207564ed9b823cc33287), [8f74d5858](https://github.com/berkinory/Glade/commit/8f74d585824929800a519d4257bcfe7e3e5e0dc7))
- Send explains why it can't send yet instead of doing nothing. ([28790d1b0](https://github.com/berkinory/Glade/commit/28790d1b0d37aedc747302298599c7314bbba3da))
- New chat no longer stops responding after an interrupted navigation, and the chat you are in no longer jumps into Drafts. ([2afa0a02b](https://github.com/berkinory/Glade/commit/2afa0a02b559f2c264f063879324f75e2ffe4e02), [d6d68cc12](https://github.com/berkinory/Glade/commit/d6d68cc128e37d8edeb00dd98b55cb4089c9b93b), [ff281472f](https://github.com/berkinory/Glade/commit/ff281472fde1aa3c18b993d66908a2afea7eb154))
- Changing access on an idle chat no longer restarts the agent. ([3718a9673](https://github.com/berkinory/Glade/commit/3718a9673f7ad19d9ac78a6fde9896175fe52391))
- Subagents are tracked correctly: stopping one no longer fails, ones stopped with their chat show as stopped, and their work and replies stay with the right chat and turn. ([a7440a916](https://github.com/berkinory/Glade/commit/a7440a91603188f41052f944673f4c6abd7b34b2), [745376f48](https://github.com/berkinory/Glade/commit/745376f48c652a7840ba10c7a4fa3dc69bb52dc4), [f12231560](https://github.com/berkinory/Glade/commit/f12231560045c81639f20085f2c6fbd8ac98f91b), [3e8a4b206](https://github.com/berkinory/Glade/commit/3e8a4b206cbf116d7ce43a138850969522600705), [e6edf9eba](https://github.com/berkinory/Glade/commit/e6edf9ebac33131af790b5b8772e1245dacabb0b))
- Claude fast mode warns when requests are actually served at standard speed. ([603030e84](https://github.com/berkinory/Glade/commit/603030e845e6de98b7c758cdd8f9634a70330119))
- Claude turns that fail on organization verification or cloud credentials say why and recover once fixed. ([4276adbcb](https://github.com/berkinory/Glade/commit/4276adbcbe067992ddae9565446cfda3672639be))
- Quitting no longer leaves idle Claude processes running. ([9688911b6](https://github.com/berkinory/Glade/commit/9688911b6db50093f4c16bea2fececbed24e0bd5))
- Usage stats no longer undercount tokens after switching providers or stopping turns that ran subagents. ([f5444d632](https://github.com/berkinory/Glade/commit/f5444d632b798372caf063d5a29d53270c9d2c42), [84928417b](https://github.com/berkinory/Glade/commit/84928417b89b24e35677d2c93c9ffc7dda522c1d))
- Provider usage loads behind proxies that use fake-IP DNS. ([58f14f220](https://github.com/berkinory/Glade/commit/58f14f2206ed462c615675eb1be7468175fc0b5d))
- Creating branches and worktrees no longer fails on name clashes or waits behind a slow push. ([c1c7d1caa](https://github.com/berkinory/Glade/commit/c1c7d1caa9f23a26fa0dfef581c6857e7e80faa4), [e02c7992b](https://github.com/berkinory/Glade/commit/e02c7992bd7f32bb0ca44aaaf4b9100750983171))
- Diffs and worktree copies are no longer altered by custom Git diff drivers. ([17f3d787d](https://github.com/berkinory/Glade/commit/17f3d787dbfe9bb8df40592324f7c6cc08767be0))
- Undo refuses to change files while another chat is working in the same folder. ([49afe3da0](https://github.com/berkinory/Glade/commit/49afe3da0c24a6760576c3422b77c3c6906b9f3a))
- Edits to the keybindings file apply without restarting. ([a53d3b801](https://github.com/berkinory/Glade/commit/a53d3b801fe9ebbd66bccac2e7f7accc8e7d4207))
- Tab strips scroll with a regular mouse wheel, files keep their scroll position across tabs, and diffs remember your layout choice. ([f9e02487a](https://github.com/berkinory/Glade/commit/f9e02487a2d6930b75893120617ded3b151095d1), [e66d92c82](https://github.com/berkinory/Glade/commit/e66d92c82b61a32d0ab335fdade1e26ba77b2108), [bee5cba21](https://github.com/berkinory/Glade/commit/bee5cba21534be0f7282eb9c12ae7657b87bc2fd))
- Add new project in the composer works in the browser and on paired devices. ([9beba2312](https://github.com/berkinory/Glade/commit/9beba2312533d07fd55a0ae2abc66b4c2f7f35f0))
- On Windows, a program in the project folder can no longer stand in for an installed agent CLI. ([3b7540110](https://github.com/berkinory/Glade/commit/3b75401101682b1bbe7f0330d7559122b2d87eb2))
- Glade picks up your PATH when your login shell is Nushell. ([e2552b348](https://github.com/berkinory/Glade/commit/e2552b3482214ea93c3751f03a50355ab96a4603))

## 0.2.3 - 2026-10-10

### New

- Use Glade from your phone or another computer: turn on Remote access in Settings, pair a device with a QR code, and reach this machine over Tailscale HTTPS or your local network. Paired devices stay signed in across restarts, can be removed at any time, and get a layout made for phones. SSH hosts offer the same from their menu, so a phone can keep working with a host while this computer is off. ([d185d89c9](https://github.com/berkinory/Glade/commit/d185d89c9052082dfb301f48f9a4ca9a2b2090cf), [05bf3af80](https://github.com/berkinory/Glade/commit/05bf3af804a7417c1ad2eb06f5eea94f8ca7d7f9), [2a57c51e8](https://github.com/berkinory/Glade/commit/2a57c51e80af766109a8cac2d0a094a88e45684e), [d9ae58744](https://github.com/berkinory/Glade/commit/d9ae5874492dbce64076150e9dd4dc067a1534d8))
- Install Glade on a Linux server or a Mac with one command, without the desktop app. It verifies the download, starts on boot, and shows a QR code to pair your phone; the `glade` command then pairs devices, turns remote access on or off, updates and uninstalls. ([bef89898d](https://github.com/berkinory/Glade/commit/bef89898d8b212b7284268cc218e5f01552327b5))
- Pair the desktop app with Glade on another computer from its pairing link. Its projects and chats appear next to yours under Remote, the way SSH hosts do. ([e2bb4f62f](https://github.com/berkinory/Glade/commit/e2bb4f62f0205e6e1ef7f7f9675d98e41913d0ea), [87d2b6543](https://github.com/berkinory/Glade/commit/87d2b6543a414c9dab8f98a4cdd1b1313434df77))

### Improved

- Provider updates for an SSH host are offered in that host's chats and install on the host. ([807c33f8d](https://github.com/berkinory/Glade/commit/807c33f8d045aacbc73c8348dbd9bb67a5c52d4e))
- SSH hosts and paired machines that drop are retried with growing pauses instead of on a fixed timer, and an unresponsive paired machine is noticed within seconds. ([a9cc2bfee](https://github.com/berkinory/Glade/commit/a9cc2bfee62d45b21dc5092a21b7403311cf53cd))

### Fixed

- Adding a project on an SSH host with a path that starts with `~` no longer fails with a missing folder error. ([1b3b3dcc2](https://github.com/berkinory/Glade/commit/1b3b3dcc28294a72fc877894e9fa016362018854))

## 0.2.2 - 2026-10-09

### New

- Run chats on other machines over SSH from the desktop app. Glade installs and updates its server on the host, and passwords and new host keys are confirmed in the app. ([87114d6c8](https://github.com/berkinory/Glade/commit/87114d6c8d59517b8656a46d3bbbd5c04fd993bc))
- Search saved chat messages and settings from the command palette. ([e98eea50d](https://github.com/berkinory/Glade/commit/e98eea50d2b6db0dee536a9f3750de003cdf5908))
- Keep your Mac awake while agents work, from Chat settings. ([96dc9a5e7](https://github.com/berkinory/Glade/commit/96dc9a5e722bf9d63cdbdc0fe77a5b78323bc645))
- Revert the changes from any commit in Source Control history, and undo a new commit right from its confirmation. ([953654a84](https://github.com/berkinory/Glade/commit/953654a849fb69d2ccb148e259eec8937c79b6e9))
- Agents can run JavaScript in the browser on your local development pages; other sites stay off limits. ([8a966b7e5](https://github.com/berkinory/Glade/commit/8a966b7e5a7c288ab5b0adf803adee94a96ebf72))
- Shortcuts to archive the open chat or mark it unread. ([f7f3f1b2c](https://github.com/berkinory/Glade/commit/f7f3f1b2caa9e3bbe6b20fe99a05c70e799dc0de))

### Improved

- Computer Use is allowed once in Settings for every chat, off by default. Agents use it when you ask, in words or with /computer, or when a task needs a desktop app, and its cursor moves more naturally. ([473f87106](https://github.com/berkinory/Glade/commit/473f8710600b99bbf0a097e9cbf3dd62f65a44b0), [248ceb731](https://github.com/berkinory/Glade/commit/248ceb731e16ccac86c800b33b9cb0f6590c697d), [507bdcb07](https://github.com/berkinory/Glade/commit/507bdcb07e47e240164f3b0047f47d1cfbe0f7ba))
- Chats stay connected and recover more reliably from interruptions, with one clear notice above the composer when the connection or server is busy. ([ae302e0e0](https://github.com/berkinory/Glade/commit/ae302e0e0002cd0c5a3ef413811616eb06eef581), [0058ec66f](https://github.com/berkinory/Glade/commit/0058ec66f49105f36f2a9e55f3f827fcc64ca3ea), [c379e02be](https://github.com/berkinory/Glade/commit/c379e02bed62472c95830401b208c321d9b29529))
- Chats stay responsive while other chats prepare or start tasks and during heavy repository activity. ([1c785250b](https://github.com/berkinory/Glade/commit/1c785250b827b982bf31f63ab7985b4b84429041))
- Failed tasks keep their error details and can be continued in the same chat or with another model. Switching providers in a chat that never reached its provider switches right away and resends your message. ([0af462882](https://github.com/berkinory/Glade/commit/0af4628826cfbb66ac5a6b6e6f840db6211d0db9), [2871882b6](https://github.com/berkinory/Glade/commit/2871882b6299dd4da21c3ecb93d63e87e32109a2))
- Disabled providers stay out of pickers, usage, plugin and skill lists and stop background discovery. ([35f725dfa](https://github.com/berkinory/Glade/commit/35f725dfa10e40c0afab0c664e2d7e4df6615cf4))
- Right-click menus share one look with icons, and text fields and images have copy and paste menus. ([44af8427b](https://github.com/berkinory/Glade/commit/44af8427b5fda2c001838b5dc28bc6b111a93ffb))
- Text follows your font settings more consistently, and question cards can be answered from the keyboard. ([f7f3f1b2c](https://github.com/berkinory/Glade/commit/f7f3f1b2caa9e3bbe6b20fe99a05c70e799dc0de))
- Scrollbars stay hidden until you scroll or hover. ([d1fe47c48](https://github.com/berkinory/Glade/commit/d1fe47c48c0dc3268429e00bb525f88637c03444))

### Fixed

- Source Control explains why it cannot open a folder, offers to trust folders owned by another user, and says when Git is not installed. ([953654a84](https://github.com/berkinory/Glade/commit/953654a849fb69d2ccb148e259eec8937c79b6e9))
- Opening a terminal no longer shows a reconnect error, and Glade no longer keeps reconnecting when Git is missing. ([ecf87d62a](https://github.com/berkinory/Glade/commit/ecf87d62ac1f45067d2ee9005aa12ed898002a81))
- Claude chats recover when interrupted before their first response, and tasks no longer wait indefinitely for their starting file snapshot. ([1c785250b](https://github.com/berkinory/Glade/commit/1c785250b827b982bf31f63ab7985b4b84429041))
- An idle chat no longer stays marked as working after its settings change. ([c734669cf](https://github.com/berkinory/Glade/commit/c734669cf512001018c6df6786caef2ee8669b54))
- Failed file uploads show their actual error. ([f60b89a06](https://github.com/berkinory/Glade/commit/f60b89a06f84f68483f4a20b4c295c5173c2e961))
- Skills with multiline descriptions display correctly. ([070278a65](https://github.com/berkinory/Glade/commit/070278a65383833a3fa9907ebac9d620f1f79ea9))
- Opening the browser no longer widens the right sidebar, and the sidebar can be resized while the browser is open. ([355067b1b](https://github.com/berkinory/Glade/commit/355067b1b637c8e7f8d7a2e61323a65417999c2b))

### Removed

- Spell checking in text fields. ([44af8427b](https://github.com/berkinory/Glade/commit/44af8427b5fda2c001838b5dc28bc6b111a93ffb))
- Turning Computer Use on or off per chat; it is one setting now. ([473f87106](https://github.com/berkinory/Glade/commit/473f8710600b99bbf0a097e9cbf3dd62f65a44b0))

## 0.2.1 - 2026-10-08

### New

- Browser Use is rebuilt: each chat has its own browser panel where agents browse with your existing sign-ins, and you can pick an element or screenshot the page to send to the agent, open the page in your default browser, open developer tools, or clear a site's data. ([233b0a006](https://github.com/berkinory/Glade/commit/233b0a0063abcecb346db04271f394b8fe2f6d7d), [09ce04c48](https://github.com/berkinory/Glade/commit/09ce04c4814ee686c89e63c58a7c2c88bab5ff4e), [3abae10aa](https://github.com/berkinory/Glade/commit/3abae10aa5c266ddc9c336dac79294a672a28422), [12f99e688](https://github.com/berkinory/Glade/commit/12f99e68851932c7ce2918491ee30d0a2ef3e84a))
- Computer Use is rebuilt on the Cua driver: agents use desktop apps after you grant access to each app in the chat, or right away when the chat has Full access. ([2985664b4](https://github.com/berkinory/Glade/commit/2985664b47210fcb470f9ae358101b6cafac9c53), [30ba21be6](https://github.com/berkinory/Glade/commit/30ba21be6dc4155f5845d71d70fbb1544bbfb175))
- Glade's browser blocks ads, trackers and cookie notices by default, with a switch in Settings and a shield in the browser panel that turns blocking off for one site. ([d7b9e531b](https://github.com/berkinory/Glade/commit/d7b9e531b214c535a5dced8414b03b393700a170), [2d411f00b](https://github.com/berkinory/Glade/commit/2d411f00b62acb0ab1ff113d6b97b95ba65d665e))

### Improved

- Explorer, Source Control, Terminal and the browser open from a new activity bar into one right sidebar, with a shortcut for each view, a shared width, and indicators when a terminal is running or an agent is browsing. Switching views is instant. ([96fea7216](https://github.com/berkinory/Glade/commit/96fea7216030d2f7de6be7d7477fb6eedd31630f), [affd48927](https://github.com/berkinory/Glade/commit/affd48927913e0b690b525abc2c848104e445d90), [ab40b5398](https://github.com/berkinory/Glade/commit/ab40b539866056e3f6647f886b1ed33bae637594))
- Browser Use reads pages with far fewer tokens and acts more reliably: it skips hidden and covered elements, fills whole forms at once, handles custom dropdowns, long lists and slow results, reports downloads, and asks you to complete CAPTCHAs in the panel. ([30a8e8ccc](https://github.com/berkinory/Glade/commit/30a8e8ccc207a9fb27491a7717da5f6d8db78496), [0dc9f6b68](https://github.com/berkinory/Glade/commit/0dc9f6b68b16990133bbf87df975915b6531e9a1), [09838f79a](https://github.com/berkinory/Glade/commit/09838f79aa90741a21d60d14b77db6e53ed57c2a), [a1adbe7db](https://github.com/berkinory/Glade/commit/a1adbe7dbf47b3a3bf07842627252667ce3e0b82))
- Computer Use tells agents what each action changed, stops repeated actions that do nothing, waits while you use the mouse or keyboard, keeps browsers read-only and terminals click-only unless you grant full control, and can be stopped everywhere with Control-Option-Command-Escape (Control-Alt-Shift-Escape on Windows and Linux). ([51ba40765](https://github.com/berkinory/Glade/commit/51ba40765b3f5d563f7ff70cb081cf2576ff530d), [01819abcf](https://github.com/berkinory/Glade/commit/01819abcf23b0b422913d1eb679d9bb964a1bed1))
- Computer Use agents can launch apps and open files or links in them, use macOS Open and Save panels without overwriting files, copy and paste between apps, select and format text, and move and resize windows. Reading clipboard content the agent did not put there asks once per chat. ([af5384b13](https://github.com/berkinory/Glade/commit/af5384b1312e0fc2aadfe5d142ceb5c62dc67021), [4befa4656](https://github.com/berkinory/Glade/commit/4befa4656eff24695c3f0eaee6da859196a3136c), [ccc3ae65a](https://github.com/berkinory/Glade/commit/ccc3ae65a9860ab7f523076ab05ceea698507cb7), [2f7437ac6](https://github.com/berkinory/Glade/commit/2f7437ac687769be934260e2a39628dff2c49afa), [5c519080f](https://github.com/berkinory/Glade/commit/5c519080f555af1a548ee7469097a5029828ff42))
- Visual replies blend into the chat with automatic height and compact controls, can load public web resources, and open links in your browser. Previews need a smaller browser download and still block local network access. ([eaaf1109f](https://github.com/berkinory/Glade/commit/eaaf1109f47445930eb462e200a111b1b0e845b1), [3515d9826](https://github.com/berkinory/Glade/commit/3515d9826097fbef93d5867a1e869f1c2bc5a4eb))
- Tool activity is grouped by kind, live groups stay steady while a turn runs, failures stand out, routine accepted approvals are hidden, and long lists of edited files scroll in place. ([caee5c87c](https://github.com/berkinory/Glade/commit/caee5c87c283d2d6746171387ef58bfac82ba246), [5168e0f63](https://github.com/berkinory/Glade/commit/5168e0f637d308da6fd80ea6f6e827aeceaa0e76), [54b7dbc9d](https://github.com/berkinory/Glade/commit/54b7dbc9df51d4bcab172bd390f49ab48ed59b98))
- Subagents get stable short names and plainer model labels, their replies show which helper sent them, and finished helpers leave the compact panels. ([6c9e29e3a](https://github.com/berkinory/Glade/commit/6c9e29e3a357475836e182acd3e50b1e85ea60b3), [bd88f6e43](https://github.com/berkinory/Glade/commit/bd88f6e431ade730981ce4f605a7c93df660dc00), [d756a7a54](https://github.com/berkinory/Glade/commit/d756a7a5474549c9f595e4d125f437522ef8f062))
- Long commits, pushes and hooks run to completion regardless of duration or output, and Git actions survive reconnects without running twice. ([58a9533d2](https://github.com/berkinory/Glade/commit/58a9533d269020d1e3daf14e025c77d7bbaad361))
- Source control stays fast: background remote refreshes never prompt for credentials or hold up local status, worktrees of one repository share them, and returning to Glade or running agent tools triggers far fewer git and GitHub refreshes. ([45b2d22dc](https://github.com/berkinory/Glade/commit/45b2d22dcffdadd172f53f891d20ac37ef927143), [d420e3aea](https://github.com/berkinory/Glade/commit/d420e3aea2e8d26f94216525ec26e2b1bd078fb7))
- The file explorer, project picker and file mentions are faster in large repositories, and installing dependencies or running builds no longer keeps source control busy. ([e5e17c9c9](https://github.com/berkinory/Glade/commit/e5e17c9c91456db6e6c9afd12f2e65139e2cfdb1))
- Claude sessions, forks, and skill and agent lists start faster, and usage indicators use far less CPU with large histories. ([e90f5ecf0](https://github.com/berkinory/Glade/commit/e90f5ecf047c2ce770783019a0b1eb0f7eb100a5))
- Provider handoffs prepare in the chat while you keep using other chats, and work after the original Claude session has been retired. ([2052eb68f](https://github.com/berkinory/Glade/commit/2052eb68ffdae1f7cf99fe93097f0de4347ea694))
- Full Access no longer asks again before Codex uses Glade's own tools. ([6c0aa0179](https://github.com/berkinory/Glade/commit/6c0aa0179b6e497191acbbb2b925501722c7e6e8))
- Question cards point out that you can type your own answer. ([91f65719c](https://github.com/berkinory/Glade/commit/91f65719c7c95184a89e706c468ea556d9d36cd1))

### Fixed

- Glade tools, including visual replies, are available in Claude chats without naming them, and only core tools load up front. ([639316703](https://github.com/berkinory/Glade/commit/639316703794e366417b1c87a14a4bf3077f30e8))
- Chats keep their place in the sidebar until you send a message instead of jumping as they start, run and finish. ([9e0ebaadc](https://github.com/berkinory/Glade/commit/9e0ebaadc64a2fed26727508ba913162496ccd40), [ec6838e98](https://github.com/berkinory/Glade/commit/ec6838e98451a5d92a0304a1b0e34ee8657f7c42))
- Visual replies keep their edits and interactive state when the theme changes or they scroll out of view. ([eaaf1109f](https://github.com/berkinory/Glade/commit/eaaf1109f47445930eb462e200a111b1b0e845b1), [702a182c8](https://github.com/berkinory/Glade/commit/702a182c8bde71727db3b766f7276a2f9df97a24))
- The browser page stays visible while menus or dialogs cover it and during screenshots. ([247676dfd](https://github.com/berkinory/Glade/commit/247676dfd573aaeebfdbed3f9e689dc4c210b458))
- Conversation rows stay in place as activity details change, message navigation stays clear of the text at every layout, and image attachments no longer get lost while switching chats. ([5168e0f63](https://github.com/berkinory/Glade/commit/5168e0f637d308da6fd80ea6f6e827aeceaa0e76))
- Voice dictation works with Codex ChatGPT sign-ins, and chats blocked by a provider delivery failure say why right away, including after a restart. ([6c0aa0179](https://github.com/berkinory/Glade/commit/6c0aa0179b6e497191acbbb2b925501722c7e6e8))
- Glade recovers abandoned startup locks, explains locks it cannot verify, and asks before quitting when the window stops responding. ([b42f4f576](https://github.com/berkinory/Glade/commit/b42f4f57620d32ac74c7a3cbb401b833ff4785ea))
- Terminals keep their last output when you quit, write far less to disk, and no longer receive typed paths while busy. ([84d1490eb](https://github.com/berkinory/Glade/commit/84d1490ebbfaf83a50d4fecbe7006135fea1aabe), [b42f4f576](https://github.com/berkinory/Glade/commit/b42f4f57620d32ac74c7a3cbb401b833ff4785ea))
- Very large code blocks in chat no longer freeze the window. ([dc5784066](https://github.com/berkinory/Glade/commit/dc5784066432876a072f7cbd50aca22ffa07459e))
- Diffs and change totals work in projects that contain another Git repository, and large turns keep their change summary. ([45b2d22dc](https://github.com/berkinory/Glade/commit/45b2d22dcffdadd172f53f891d20ac37ef927143), [9461860d7](https://github.com/berkinory/Glade/commit/9461860d7d996352937a042995bcf0d576cb065f))
- Reverting or deleting a chat no longer removes attached images when the change fails to save. ([9461860d7](https://github.com/berkinory/Glade/commit/9461860d7d996352937a042995bcf0d576cb065f))
- Codex chats keep working after their workspace folder is deleted. ([0c7338979](https://github.com/berkinory/Glade/commit/0c733897912e949952421b7ab1c5430c11910f52))
- Skill and agent lists use your configured Claude CLI path, custom Codex providers no longer stall the app, and the local server list no longer hangs. ([e90f5ecf0](https://github.com/berkinory/Glade/commit/e90f5ecf047c2ce770783019a0b1eb0f7eb100a5))
- The Windows taskbar icon recovers if its first-launch setup is interrupted. ([15020d142](https://github.com/berkinory/Glade/commit/15020d142d09a7af86a7a5aeb4813ae6a064c9ed))

### Removed

- Removed the browser's saved-login vault; agents use the sign-ins you make in the browser instead. ([4dede481c](https://github.com/berkinory/Glade/commit/4dede481c16735bfec0b75c4f675e611335aab91))
- Removed chat split views; terminal splits remain. ([1ddef09ed](https://github.com/berkinory/Glade/commit/1ddef09ed4b5d8360c841c8404f3c5dd16fd2312))
- Removed the source-code view from visual replies. ([eaaf1109f](https://github.com/berkinory/Glade/commit/eaaf1109f47445930eb462e200a111b1b0e845b1))
- Removed the header buttons for the browser and right sidebar and terminal tabs in the top tab bar; use the activity bar instead. ([96fea7216](https://github.com/berkinory/Glade/commit/96fea7216030d2f7de6be7d7477fb6eedd31630f))

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
