import './Modal.css';

export interface ModalHooks {
  /** Called when the modal opens/closes - MainPage uses this to lock/unlock map interaction. */
  onOpen?: () => void;
  onClose?: () => void;
}

/** A line rendered as a link that opens in a new tab. */
export interface ModalLink {
  text: string;
  href: string;
}

/** A single display line. A string[] renders as one block with tight
 * (<br>-separated) spacing between its sub-lines - used for a multi-line
 * entity like an address, which is conceptually one piece of information.
 * A ModalLink renders as a link. */
export type ModalLine = string | string[] | ModalLink;

/**
 * What: Returns href only if it's an http(s) URL.
 * Why: Link targets can come from data files/DB rows that shouldn't be
 * trusted; a "javascript:" or other-scheme URL must never become a live link.
 * Without it: A malicious or malformed website value could run script when clicked.
 * Inputs: href - the candidate URL.
 * Output: The normalized URL string if it parses as http/https, else null.
 */
function safeHttpUrl(href: string): string | null {
  try {
    const url = new URL(href);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * What: A generic, reusable modal - title + an ordered list of info lines +
 * an exit button.
 * Why: One of the two stable "plugs" in this app's architecture. Knows
 * nothing about maps, entities, or geocoding, so the same component works
 * regardless of which map/entity/geocoding provider is plugged in, and
 * regardless of what category of entity (restaurant, clothing store, ...) is
 * being shown. Built with plain DOM so it's dependency-free to unit test.
 * Without it: Modal markup/behavior (open/close, line rendering, the
 * exit-button-only close rule) would be duplicated or hand-rolled wherever
 * entity details need to be shown, and every change to it would risk
 * dragging in map/entity-specific assumptions.
 * Inputs: n/a (class declaration - see each member below).
 * Output: n/a (class declaration - see each member below).
 */
export class Modal {
  private readonly backdrop: HTMLDivElement;
  private readonly titleEl: HTMLHeadingElement;
  private readonly detailsEl: HTMLDivElement;

  /**
   * What: Builds the modal's DOM (backdrop, box, close button, title,
   * details container) inside the given root and wires the close button.
   * Why: The modal needs to exist in the DOM before MainPage can call
   * setTitle/setLines/open on it; hooks let the caller react to open/close
   * without Modal needing to know what "locking map interaction" means.
   * Without it: There would be no modal DOM to show, and no way for callers
   * to hook into its lifecycle.
   * Inputs: root - the element to mount the modal's DOM into; hooks -
   * optional onOpen/onClose callbacks.
   * Output: n/a (constructor) - the modal's DOM exists afterward, hidden by default.
   */
  constructor(root: HTMLElement, private readonly hooks: ModalHooks = {}) {
    this.backdrop = document.createElement('div');
    this.backdrop.className = 'modal-backdrop hidden';

    const box = document.createElement('div');
    box.className = 'modal-box';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'modal-close';
    closeButton.setAttribute('aria-label', 'Close');
    closeButton.textContent = '×';
    closeButton.addEventListener('click', () => this.close());

    this.titleEl = document.createElement('h2');
    this.titleEl.className = 'modal-title';

    this.detailsEl = document.createElement('div');
    this.detailsEl.className = 'modal-details';

    box.append(closeButton, this.titleEl, this.detailsEl);
    this.backdrop.append(box);
    root.append(this.backdrop);
  }

  /**
   * What: Sets the modal's title text.
   * Why: Lets the caller (MainPage) show the clicked entity's name without
   * Modal needing to know what an "entity" is.
   * Without it: There would be no way to label what the modal is showing.
   * Inputs: text - the title string (set via textContent, not innerHTML, so
   * it's always treated as plain text - safe even if it came from
   * third-party data like OpenStreetMap names).
   * Output: None (void) - updates the rendered title as a side effect.
   */
  setTitle(text: string): void {
    this.titleEl.textContent = text;
  }

  /**
   * What: Replaces the modal's body with the given lines, each its own
   * paragraph (wide spacing between entities), except an array entry, which
   * renders as one paragraph with tight (<br>-separated) spacing between its
   * sub-lines.
   * Why: Lets the caller show a progressively-loading, ordered mix of
   * independent facts (distance, address, phone) where a multi-line fact
   * (the address) should read as one entity rather than several.
   * Without it: Every line would need identical spacing, address street/city
   * lines looking like unrelated facts rather than one address block.
   * Inputs: lines - ordered list of ModalLine entries (plain strings,
   * string arrays for tight-spaced multi-line blocks, or links). A link
   * whose href isn't http(s) is rendered as plain text instead.
   * Output: None (void) - replaces the modal's rendered body as a side
   * effect. Built via textContent/DOM nodes rather than innerHTML, since
   * lines can come from third-party data (OSM names/addresses) that
   * shouldn't be trusted as HTML.
   */
  setLines(lines: ModalLine[]): void {
    while (this.detailsEl.firstChild) this.detailsEl.removeChild(this.detailsEl.firstChild);

    lines.forEach((line) => {
      const p = document.createElement('p');
      if (typeof line === 'object' && !Array.isArray(line)) {
        const href = safeHttpUrl(line.href);
        if (href) {
          const a = document.createElement('a');
          a.href = href;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.textContent = line.text;
          p.append(a);
        } else {
          p.textContent = line.text;
        }
        this.detailsEl.append(p);
        return;
      }
      const sublines = Array.isArray(line) ? line : [line];
      sublines.forEach((text, i) => {
        if (i > 0) p.appendChild(document.createElement('br'));
        p.appendChild(document.createTextNode(text));
      });
      this.detailsEl.append(p);
    });
  }

  /**
   * What: Shows the modal and locks the page's background scroll.
   * Why: Called whenever MainPage has something to show (an entity was
   * clicked); the onOpen hook is how MainPage locks map interaction without
   * Modal knowing what a map is.
   * Without it: The modal would never become visible, and nothing behind it
   * (map or page) would be protected from interaction while it's shown.
   * Inputs: None.
   * Output: None (void) - side effects only (shows the backdrop, adds
   * body.modal-open, invokes onOpen).
   */
  open(): void {
    this.backdrop.classList.remove('hidden');
    document.body.classList.add('modal-open');
    this.hooks.onOpen?.();
  }

  /**
   * What: Hides the modal and restores background scroll.
   * Why: Only ever called from the exit button's click handler (by design -
   * clicking outside the modal must not close it), and invokes onClose so
   * MainPage can unlock map interaction.
   * Without it: The modal, once open, could never be dismissed, and map
   * interaction locked by lockInteraction() would never be restored.
   * Inputs: None.
   * Output: None (void) - side effects only (hides the backdrop, removes
   * body.modal-open, invokes onClose).
   */
  close(): void {
    this.backdrop.classList.add('hidden');
    document.body.classList.remove('modal-open');
    this.hooks.onClose?.();
  }
}
