# Case Forge chat component selection

Verified 17 September 2026 against primary GitHub sources, pinned npm metadata and downloaded package bytes. This document covers component research and vendoring; application integration and live ChatGPT verification are separate work.

## Decision

Use **Deep Chat 2.5.1** for the existing plain ESM/Electron assistant. It is an MIT Web Component with its own Shadow DOM, a composer, Markdown messages, loading and stop controls, scrolling, and a custom service adapter. It does not require introducing React or a renderer build pipeline.

| Component | Verified package | Fit and limitations |
| --- | --- | --- |
| [Deep Chat](https://github.com/OvidijusParsiunas/deep-chat/tree/2.5.1) | 2.5.1; published 2026-08-27; MIT | Best fit. Custom request and stream handlers, open Shadow DOM, configurable appearance. Add our own conversation announcements and safe link handling. |
| [vue-advanced-chat](https://github.com/advanced-chat/advanced-chat-components/tree/2.1.2) | 2.1.2; published 2025-12-19; MIT | Viable standalone Web Component with its Vue runtime bundled, Shadow DOM, light/dark themes. Primarily a room/messenger interface; streaming requires updating messages through the host. Disable emoji features or vendor its default remote emoji dataset. Its newer v3 line is a release candidate and uses light DOM. |
| [assistant-ui](https://github.com/assistant-ui/assistant-ui) | @assistant-ui/react 0.15.20; published 2026-09-15; MIT | Strong AI chat features and accessibility primitives, but requires React and supporting packages/component setup. |
| [Chatscope](https://github.com/chatscope/chat-ui-kit-react) | @chatscope/chat-ui-kit-react 2.1.1; published 2025-05-15; MIT | Polished messaging components; requires React, separate styles and dependencies. |
| [OpenAI ChatKit](https://github.com/openai/chatkit-js) | Official README inspected | Framework-neutral, but the documented renderer loads from OpenAI's CDN and uses ChatKit sessions. A fully vendorable renderer was not verified; it does not meet this integration's offline UI requirement. |

Measured sizes, without installing packages:

| Artifact | Bytes | Gzip bytes |
| --- | ---: | ---: |
| Deep Chat 2.5.1 `dist/deepChat.bundle.js` | 386,971 | 107,782 |
| Deep Chat complete npm download | 2,205,078 | Already compressed |
| vue-advanced-chat 2.1.2 `dist/vue-advanced-chat.es.js` | 1,064,604 | 212,793 |
| vue-advanced-chat complete npm download | 386,094 | Already compressed |

The Deep Chat browser bundle is self-contained ESM. Apparent `import Remarkable` text inside it is a warning example string, not an unresolved dependency. Its [Rollup recipe](https://github.com/OvidijusParsiunas/deep-chat/blob/2.5.1/component/rollup.config.js) bundles the imports.

## Vendored artifacts

Location: `app/public/vendor/deep-chat/2.5.1/`

- `deepChat.bundle.js`: unchanged published browser bundle.
- `LICENSE`: unchanged upstream MIT license.
- `THIRD-PARTY-NOTICES.md`: licenses for the declared runtime dependency closure from the pinned upstream lockfile. Includes conservative extra notices for CLI/transitive modules that may not be included in the browser bundle.
- `PROVENANCE.json`: upstream commit, npm archive integrity and hash, file hashes, exact dependency versions and notice provenance.

Pinned upstream commit: `b537bcc6219bbe937ee8159166444912e56973f0`.

Bundle SHA-256: `6844eaf354e19d50dcdd8ee78968d6ae32ccd4b9f15a883902d60e93d69caf84`.

The npm archive was verified against its pinned SHA-512 before selecting files. Dependency archives were separately verified against the upstream lockfile. The `speech-to-element` npm archive lacks a license file; its MIT license was retrieved from its published npm `gitHead`, `97319f8119717bb4425bd1548cb308708430cc1a`.

No npm install, runtime CDN script, backend change or package-lock change was needed for vendoring.

## Integration API

Keep the existing account/sign-in controls and desktop authentication/transport in `app/public/assistant.js`. Replace only the conversation/composer with the component. Set object/function properties directly before appending it to the DOM:

```js
import './vendor/deep-chat/2.5.1/deepChat.bundle.js';

const chat = document.createElement('deep-chat');
chat.chatStyle = {
  width: '100%', height: '100%', border: 'none',
  fontFamily: 'inherit', backgroundColor: 'transparent',
};
chat.textInput = {
  characterLimit: 12000,
  placeholder: { text: 'Message ChatGPT…' },
  styles: { container: {}, text: {}, focus: {} },
};
chat.requestBodyLimits = { maxMessages: 1, totalMessagesMaxCharLength: 12000 };
chat.remarkable = { html: false, breaks: true };
```

`fontFamily` must be explicitly set to our existing local/system font before rendering. Otherwise [the default font loader](https://github.com/OvidijusParsiunas/deep-chat/blob/2.5.1/component/src/utils/webComponent/googleFont.ts) injects a Google Fonts stylesheet. Keep `directConnection`, `webModel`, speech, file controls and `browserStorage` unset unless they are separately integrated. Browser persistence is opt-in; a shared default localStorage key must not mix accounts or cases.

The [custom handler](https://deepchat.dev/docs/connect/#handler) accepts `{messages:[{role,text}]}` and returns through signals:

```js
chat.connect = {
  stream: true,
  handler: async (body, signals) => {
    signals.stopClicked.listener = () => desktop.chatGPTCancel();
    signals.onOpen();
    try {
      const text = body.messages.at(-1)?.text || '';
      const result = await desktop.chatGPTChat({ text });
      if (result.error) throw new Error(result.error);
      await signals.onResponse({ text: result.text });
    } catch (error) {
      await signals.onResponse({ error: error.message });
    } finally {
      signals.onClose();
    }
  },
};
```

This example displays one completed response from the current desktop bridge. Genuine streaming requires forwarding actual model deltas through `signals.onResponse({text:delta})`; no simulated streaming is required. The host must retain its authentication, busy/request identity and cancellation checks and discard late results after cancellation, sign-out or context changes. For a non-stream handler, omit `stream` and use `onResponse` without stream lifecycle callbacks.

Useful verified properties and methods:

| Concern | API |
| --- | --- |
| Submit availability | `chat.disableSubmitButton(true)` / `false`, after initial render; validate account/busy state inside the handler too. |
| Input availability | `textInput.disabled` in the configuration; object property reassignment schedules component rendering. |
| Input length | `textInput.characterLimit: 12000`; independently enforce the transport limit. |
| Clear conversation | `chat.clearMessages(true)`; keep any supplied `history` empty when clearing accounts. |
| Read/display history | `chat.getMessages()`, `chat.history`, `chat.addMessage({role:'ai',text})`. |
| Focus/placeholder | `chat.focusInput()`, `chat.setPlaceholderText(text)`. |
| Container styling | `chatStyle` object or host style; inherited CSS variables can use Case Forge theme values. |
| Message styling | `messageStyles.default.shared/user/ai`, each with `outerContainer`, `innerContainer`, `bubble`, `media`. |
| Loading appearance | `messageStyles.loading.message = {styles:{bubble:{...}},html:trustedStaticMarkup}`; `displayLoadingBubble` is optional. Supplying its `toggle` object makes loading manually controlled. |
| Avatar | `avatars = {ai:{src:'/local/path.svg',styles:{avatar:{width:'24px',height:'24px'}}}}`. |
| Submit/stop styling | `submitButtonStyles.submit/loading/stop/disabled` plus `position` and `tooltip`. |
| Initial render callback | `onComponentRender = ref => { ... }`; fires once per element. `ref.shadowRoot` is open. |
| Message callback | `onMessage = ({message,isHistory}) => { ... }`. |

Type references: [text input](https://github.com/OvidijusParsiunas/deep-chat/blob/2.5.1/component/src/types/textInput.ts), [message styles](https://github.com/OvidijusParsiunas/deep-chat/blob/2.5.1/component/src/types/messages.ts), [submit controls](https://github.com/OvidijusParsiunas/deep-chat/blob/2.5.1/component/src/types/submitButton.ts), [component methods/lifecycle](https://github.com/OvidijusParsiunas/deep-chat/blob/2.5.1/component/src/deepChat.ts).

## Integration checks

- Preserve Case Forge's CSP. Function-valued HTML attributes use `new Function`; direct JavaScript property assignment avoids that path and needs no `unsafe-eval` exception.
- Never pass model output into the component's `html` field. [Upstream Remarkable configuration](https://github.com/OvidijusParsiunas/deep-chat/blob/2.5.1/component/src/views/chat/messages/remarkable/remarkableConfig.ts) overrides link validation to accept every link. Capture link clicks on the persistent shadow root and route allowed HTTP(S) links through the application's safe external-link opener. Reject other protocols. Keep HTML parsing disabled.
- The bundle contains keyboard button behavior, input labels and busy/disabled ARIA, but no `aria-live` conversation announcements were found. Add a conversation log and polite final-message/status announcements; verify keyboard focus and screen-reader names. [Button accessibility source](https://github.com/OvidijusParsiunas/deep-chat/blob/2.5.1/component/src/views/chat/input/buttons/buttonAccessility.ts).
- Verify the integrated component at Case Forge's compact window size in both themes, with long replies, multiline input, a scrolled-up conversation, cancellation, sign-out and offline launch. Research and artifact verification do not substitute for this UI validation.

Official OpenAI assets were found in `openai/codex` under `codex-rs/skills/src/assets/samples/openai-docs/assets/`: `openai-small.svg` and `openai.png`. Branding selection and use remain separate from this component integration.
