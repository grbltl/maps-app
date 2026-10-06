import './Modal.css';

export interface ModalHooks {
  /** Called when the modal opens/closes - MainPage uses this to lock/unlock map interaction. */
  onOpen?: () => void;
  onClose?: () => void;
}

/** A single display line. A string[] renders as one block with tight
 * (<br>-separated) spacing between its sub-lines - used for a multi-line
 * entity like an address, which is conceptually one piece of information. */
export type ModalLine = string | string[];

/**
 * A generic, reusable modal: title + an ordered list of info lines + an exit
 * button. Knows nothing about maps, entities, or geocoding - MainPage decides
 * what to put in it. Built with plain DOM so it's dependency-free to unit test.
 */
export class Modal {
  private readonly backdrop: HTMLDivElement;
  private readonly titleEl: HTMLHeadingElement;
  private readonly detailsEl: HTMLDivElement;

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

  setTitle(text: string): void {
    this.titleEl.textContent = text;
  }

  setLines(lines: ModalLine[]): void {
    while (this.detailsEl.firstChild) this.detailsEl.removeChild(this.detailsEl.firstChild);

    lines.forEach((line) => {
      const p = document.createElement('p');
      const sublines = Array.isArray(line) ? line : [line];
      sublines.forEach((text, i) => {
        if (i > 0) p.appendChild(document.createElement('br'));
        p.appendChild(document.createTextNode(text));
      });
      this.detailsEl.append(p);
    });
  }

  open(): void {
    this.backdrop.classList.remove('hidden');
    document.body.classList.add('modal-open');
    this.hooks.onOpen?.();
  }

  close(): void {
    this.backdrop.classList.add('hidden');
    document.body.classList.remove('modal-open');
    this.hooks.onClose?.();
  }
}
