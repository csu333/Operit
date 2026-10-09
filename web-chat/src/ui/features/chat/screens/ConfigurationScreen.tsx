import { CopyIcon, KeyIcon, LinkIcon } from '../util/chatIcons';

export function ConfigurationScreen({
  tokenDraft,
  error,
  suggestedUrl,
  onTokenDraftChange,
  onSubmit,
  onCopyUrl
}: {
  tokenDraft: string;
  error: string | null;
  suggestedUrl: string;
  onTokenDraftChange: (value: string) => void;
  onSubmit: () => void;
  onCopyUrl: () => void;
}) {
  return (
    <div className="chat-connection-overlay">
      <section className="configuration-screen" role="dialog">
        <div className="configuration-screen-header">
          <span>LAN web connection</span>
          <h1>Enter Bearer Token</h1>
          <p>After connecting you go straight into the phone's current chat; history, theme and streaming replies stay in sync with the phone.</p>
        </div>

        <div className="configuration-screen-block">
          <label className="configuration-screen-label" htmlFor="web-chat-url">
            <LinkIcon size={16} />
            <span>Address</span>
          </label>
          <div className="configuration-screen-inline-card">
            <code id="web-chat-url">{suggestedUrl}</code>
            <button onClick={onCopyUrl} type="button">
              <CopyIcon size={16} />
            </button>
          </div>
        </div>

        <div className="configuration-screen-block">
          <label className="configuration-screen-label" htmlFor="web-chat-token">
            <KeyIcon size={16} />
            <span>Bearer Token</span>
          </label>
          <input
            id="web-chat-token"
            onChange={(event) => onTokenDraftChange(event.target.value)}
            placeholder="Enter the token shown on the settings page"
            type="password"
            value={tokenDraft}
          />
        </div>

        {error ? <div className="chat-inline-error is-card-error">{error}</div> : null}

        <button className="configuration-screen-submit" onClick={onSubmit} type="button">
          Connect web chat
        </button>
      </section>
    </div>
  );
}
