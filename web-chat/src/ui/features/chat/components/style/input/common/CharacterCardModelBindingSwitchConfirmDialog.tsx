export function CharacterCardModelBindingSwitchConfirmDialog({
  open,
  onConfirm,
  onDismiss
}: {
  open: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="dialog-scrim" onClick={onDismiss} role="presentation">
      <div
        className="history-dialog model-selector-confirm-dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header>
          <h3>Change the character card's bound model</h3>
          <p>The current character card is bound to a chat model. Continuing changes this character card's model binding; the global chat model configuration is not changed.</p>
        </header>
        <footer>
          <button onClick={onDismiss} type="button">
            Cancel
          </button>
          <button onClick={onConfirm} type="button">
            Confirm change
          </button>
        </footer>
      </div>
    </div>
  );
}
