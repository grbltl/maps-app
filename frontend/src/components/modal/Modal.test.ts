import { describe, expect, it, vi } from 'vitest';
import { Modal } from './Modal';

function mountModal() {
  const root = document.createElement('div');
  document.body.append(root);
  const onOpen = vi.fn();
  const onClose = vi.fn();
  const modal = new Modal(root, { onOpen, onClose });
  return { root, modal, onOpen, onClose };
}

describe('Modal', () => {
  it('starts hidden', () => {
    const { root } = mountModal();
    expect(root.querySelector('.modal-backdrop')?.classList.contains('hidden')).toBe(true);
  });

  it('open()/close() toggle visibility and fire hooks', () => {
    const { root, modal, onOpen, onClose } = mountModal();
    modal.open();
    expect(root.querySelector('.modal-backdrop')?.classList.contains('hidden')).toBe(false);
    expect(onOpen).toHaveBeenCalledTimes(1);

    modal.close();
    expect(root.querySelector('.modal-backdrop')?.classList.contains('hidden')).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('only closes via the exit button, not by clicking the backdrop', () => {
    const { root, modal, onClose } = mountModal();
    modal.open();

    const backdrop = root.querySelector('.modal-backdrop') as HTMLElement;
    backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();

    (root.querySelector('.modal-close') as HTMLElement).click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('setTitle sets the heading text', () => {
    const { root, modal } = mountModal();
    modal.setTitle("Adamos Pizzas");
    expect(root.querySelector('.modal-title')?.textContent).toBe('Adamos Pizzas');
  });

  it('setLines renders each entry as its own paragraph, and arrays as one paragraph with <br> between sub-lines', () => {
    const { root, modal } = mountModal();
    modal.setLines(['1.8 mi away', ['18484 Preston Rd', 'Dallas, TX 75252'], '+1-469-497-1415']);

    const paragraphs = root.querySelectorAll('.modal-details p');
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs[0].textContent).toBe('1.8 mi away');
    expect(paragraphs[1].innerHTML).toBe('18484 Preston Rd<br>Dallas, TX 75252');
    expect(paragraphs[2].textContent).toBe('+1-469-497-1415');
  });

  it('setLines clears previously rendered lines', () => {
    const { root, modal } = mountModal();
    modal.setLines(['first']);
    modal.setLines(['second']);
    const paragraphs = root.querySelectorAll('.modal-details p');
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0].textContent).toBe('second');
  });
});
