import './Toast.css';

/** An optional button shown in the toast (e.g. "Retry"). */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

// How long a toast stays up before fading out on its own.
const DEFAULT_DURATION_MS = 6000;

/**
 * What: A generic, reusable toast - a short message (plus an optional action
 * button) in a pill at the bottom center of its container, fading out on
 * its own.
 * Why: Non-blocking feedback for things that went wrong in the background
 * (not tied to a form field). Like Modal, it knows nothing about maps,
 * entities, or what the message means.
 * Without it: Background errors would need ad-hoc text somewhere in the
 * controls panel, taking space even when there's nothing to say.
 * Inputs: n/a (class declaration - see each member below).
 * Output: n/a (class declaration - see each member below).
 */
export class Toast {
  private readonly el: HTMLDivElement;
  private readonly messageEl: HTMLSpanElement;
  private readonly actionEl: HTMLButtonElement;
  private action: ToastAction | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * What: Builds the (hidden) toast DOM inside root and wires its button.
   * Why: The toast exists from the start so showing it is just a class
   * toggle - and so screen readers already know the live region.
   * Without it: There would be nothing to show.
   * Inputs: root - the element to render into; durationMs - how long a
   * shown toast stays before fading out.
   * Output: n/a (constructor).
   */
  constructor(
    root: HTMLElement,
    private readonly durationMs = DEFAULT_DURATION_MS
  ) {
    this.el = document.createElement('div');
    this.el.className = 'toast';
    this.el.setAttribute('role', 'alert');

    this.messageEl = document.createElement('span');
    this.messageEl.className = 'toast-message';

    this.actionEl = document.createElement('button');
    this.actionEl.type = 'button';
    this.actionEl.className = 'toast-action';
    this.actionEl.addEventListener('click', () => {
      const action = this.action;
      this.hide();
      action?.onClick();
    });

    this.el.append(this.messageEl, this.actionEl);
    root.append(this.el);
  }

  /**
   * What: Shows message (replacing any toast already showing) and restarts
   * the fade-out timer.
   * Why: The single way callers surface a background problem.
   * Without it: See the class doc.
   * Inputs: message - the text; action - optional button; tapping it hides
   * the toast, then calls action.onClick.
   * Output: None (void).
   */
  show(message: string, action?: ToastAction): void {
    this.messageEl.textContent = message;
    this.action = action ?? null;
    this.actionEl.textContent = action?.label ?? '';
    this.actionEl.hidden = !action;
    this.el.classList.add('visible');

    if (this.hideTimer !== null) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.hide(), this.durationMs);
  }

  /**
   * What: Hides the toast (no-op if it isn't showing).
   * Why: Callers hide it once the problem it described is resolved.
   * Without it: A stale error would linger until its timer ran out.
   * Inputs: None.
   * Output: None (void).
   */
  hide(): void {
    if (this.hideTimer !== null) clearTimeout(this.hideTimer);
    this.hideTimer = null;
    this.action = null;
    this.el.classList.remove('visible');
  }

  /**
   * What: Whether the toast is currently showing.
   * Why: Lets tests (and callers, if ever needed) check state without
   * reaching into class names.
   * Without it: Tests would depend on the CSS class name.
   * Inputs: None.
   * Output: true while visible.
   */
  isVisible(): boolean {
    return this.el.classList.contains('visible');
  }
}
