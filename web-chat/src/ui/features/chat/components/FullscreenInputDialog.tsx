export function FullscreenInputDialog({
  value,
  onValueChange,
  onDismiss,
  onConfirm
}: {
  value: string;
  onValueChange: (value: string) => void;
  onDismiss: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="dialog-scrim" role="presentation">
      <div className="fullscreen-input-dialog" role="dialog">
        <header>
          <span>Input extension</span>
          <h3>Fullscreen input</h3>
        </header>
        <textarea onChange={(event) => onValueChange(event.target.value)} value={value} />
        <footer>
          <button onClick={onDismiss} type="button">
            Cancel
          </button>
          <button onClick={onConfirm} type="button">
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}
