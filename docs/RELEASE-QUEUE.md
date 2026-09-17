# Independent update messages and publisher queue

Trigger stays: `Update` then `message, <admin message>`. The skill is **caseforge-release**, MCP **caseforge_release**.

Each agent submits one durable queue entry from its own isolated checkout. `enqueue_release` saves its message and a retry ID; `claim_release` returns either its waiting position or a reserved version. Builds and publication must belong to the head of the queue. The agent integrates the latest published main commit before building, so the newest version includes earlier releases. Publication completes the slot; failures retain it for retry. `release_queue` shows progress, and `cancel_queued_release` cancels the owning checkout's unfinished work when authorized. The owner panel displays pending entries.

The queue is stored at `%LOCALAPPDATA%/CaseForgeRelease/queue.json`. Its mutex and build/publish lock are shared across all checkouts under that publisher account. Use one publisher machine/account. This does not coordinate independent publisher machines, old tool processes or raw commands that bypass the procedure. Queue processing is performed by the submitting agents; there is no unattended worker. Reconnect MCP/admin processes after upgrading.

After assets pass verification, publication attaches `update-messages.json` to the release. This contains each completed public Windows release's version, message and date. Queued and draft messages are not sent to clients. The installed app retains a validated local cache and checks this static asset every 10 seconds, including during a download. Metadata checks run every minute and on new-message arrival. GitHub caching and network delays can extend this interval; this is polling, not a push socket.

The existing quiet icon announces arrivals. Opening it shows each message newer than the installed version separately, newest first. One Download button refreshes installer metadata and selects the newest available version; it refuses metadata older than a known message. A newer arrival never resets progress or changes the target of an in-flight download. It remains available after that installation. Closing the card does not delete messages. Once the newest version is installed, the app returns to its up-to-date state.

Clients must install 0.14.19 or later once to gain this history view. Earlier updater clients still receive the newest installer through their existing feed.

Validation covers simultaneous submissions, retry identity, FIFO reservation, cancellation boundaries, recovery after failure, corrupt queues, cached/offline history, stale feeds, independent messages during a download and one-action newest-version selection. Native UI tests use disposable fictional profiles and simulated updater events; they do not install into the user's app.
