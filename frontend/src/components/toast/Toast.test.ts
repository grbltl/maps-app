import { afterEach, describe, expect, it, vi } from 'vitest';
import { Toast } from './Toast';

function setup(durationMs?: number) {
  const root = document.createElement('div');
  const toast = new Toast(root, durationMs);
  const action = () => root.querySelector('.toast-action') as HTMLButtonElement;
  return { root, toast, action };
}

describe('Toast', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts hidden and shows the message', () => {
    const { root, toast } = setup();
    expect(toast.isVisible()).toBe(false);
    toast.show('Something went wrong');
    expect(toast.isVisible()).toBe(true);
    expect(root.querySelector('.toast-message')?.textContent).toBe('Something went wrong');
  });

  it('hides the action button when no action is given', () => {
    const { toast, action } = setup();
    toast.show('No action');
    expect(action().hidden).toBe(true);
  });

  it('runs the action and hides itself when the action is tapped', () => {
    const { toast, action } = setup();
    const onClick = vi.fn();
    toast.show('Failed', { label: 'Retry', onClick });
    expect(action().textContent).toBe('Retry');

    action().click();
    expect(onClick).toHaveBeenCalledOnce();
    expect(toast.isVisible()).toBe(false);
  });

  it('fades out on its own, and showing again restarts the timer', () => {
    vi.useFakeTimers();
    const { toast } = setup(1000);
    toast.show('first');
    vi.advanceTimersByTime(800);
    toast.show('second');
    vi.advanceTimersByTime(800);
    expect(toast.isVisible()).toBe(true);
    vi.advanceTimersByTime(200);
    expect(toast.isVisible()).toBe(false);
  });
});
